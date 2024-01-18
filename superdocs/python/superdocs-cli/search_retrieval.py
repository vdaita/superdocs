from functools import partial
from typing import List
import requests
from readability import Document

from markdownify import markdownify as md

from langchain.chat_models import ChatOpenAI
from googlesearch import search
from trafilatura import fetch_url, extract
import tiktoken
from langchain.text_splitter import TokenTextSplitter
from langchain.prompts import PromptTemplate
from langchain.schema import StrOutputParser, HumanMessage, SystemMessage, AIMessage
from langchain.chains.summarize import load_summarize_chain
from .prompts import SNIPPET_EXTRACTION_PROMPT

import re

text_splitter = TokenTextSplitter(chunk_size=3000, chunk_overlap=500)
extractive_text_splitter = TokenTextSplitter(chunk_size=400, chunk_overlap=0)

# retrieval_function = {
#     "name": "retrieve_documentation_and_search",
#     "description": 
# }

def join_texts(texts: List[str]) -> str:
    return "\n\n".join(text for text in texts)

def extract_content(text, tag):
    pattern = r'<' + tag + '>(.*?)</' + tag + '>'
    matches = re.findall(pattern, text, re.DOTALL)
    return matches

def summary(objective, content, api_key, base_url, model_name):
    # Question: if someone were to try and implement objective, what information should be sent over?
    model = ChatOpenAI(temperature = 0.1, base_url=base_url, api_key=api_key, model=model_name) # TODO: Switch to Mistral

    extracted_content_list = []
    
    if isinstance(content, str):
        split_content = extractive_text_splitter.split_text(content)
    elif isinstance(content, list):
        split_content = []
        for content_chunk in content:
            split_content.extend(extractive_text_splitter.split_text(content_chunk))

    chunk_count = 25

    for start in range(0, len(split_content), chunk_count):
        selected_range = split_content[start: max(start + chunk_count, len(split_content))]
        snippet_statements = ""
        for snippet_index, snippet in enumerate(selected_range):
            snippet_statements += f"# Snippet {snippet_index}: \n \n {snippet} \n \n"

        response = model([SystemMessage(content=SNIPPET_EXTRACTION_PROMPT), HumanMessage(content=f"Objective: {objective}"), HumanMessage(content=f"Snippets: \n \n {snippet_statements}")])
        response = response.content
        snippets = extract_content(response, "snippet")
        for snippet in snippets:
            try:
                selected_index = int(snippet)
                extracted_content_list.append(selected_range[selected_index])
            except Exception:
                print("There was an error figuring out what is snippet: ", id)

    if len(extracted_content_list) > 10:
        return summary(objective, extracted_content_list, api_key, base_url, model_name)
    else: 
        summary_statement = "\n".join([f"### Snippet {i}: \n {extracted_content_list[i]}" for i in range(len(extracted_content_list))])
        return f"Selected snippets to solve objective {objective}: {summary_statement}"



def retrieve_content(question: str, api_key: str, base_url: str, model_name: str):
    # identify 
    results = search(question, num_results=3, advanced=True, timeout=5)
    combined_text = ""
    for result in results:
        response = requests.get(result.url)
        doc = Document(response.text)
        html_summary = doc.summary()
        combined_text += "\n\n" + md(html_summary)

    return summary(question, combined_text, api_key, base_url, model_name)    