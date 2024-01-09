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
from langchain.schema import StrOutputParser
from langchain.chains.summarize import load_summarize_chain

text_splitter = TokenTextSplitter(chunk_size=3000, chunk_overlap=500)

# retrieval_function = {
#     "name": "retrieve_documentation_and_search",
#     "description": 
# }

summarize_prompt = PromptTemplate.from_template("The user is trying to answer this question: \"{question}\". Find and summarize the most relevant parts of the following context to do so. If nothing is relevant to the question, don't output anything. \n \n Context: {context} \n \n")
collapse_prompt = PromptTemplate.from_template("Collapse this content while still answering the following question: \"{question}\". \n \n Content: {content}")

def join_texts(texts: List[str]) -> str:
    return "\n\n".join(text for text in texts)

def summary(objective, content, api_key, base_url, model_name):
    model = ChatOpenAI(temperature = 0, base_url=base_url, api_key=api_key, model=model_name) # TODO: Switch to Mistral

    docs = text_splitter.create_documents([content])
    for index, doc in enumerate(docs):
        print(f"Document {index}: with length {len(doc.page_content)}")
    
    map_prompt = """
    Extract the necessary information needed to complete {objective} from the following text: \n \n
    "{text}"
    \n \n
    Condensed:
    """
    map_prompt_template = PromptTemplate(template=map_prompt, input_variables=["text", "objective"])
    
    summary_chain = load_summarize_chain(
        llm=model, 
        chain_type='map_reduce',
        map_prompt = map_prompt_template,
        combine_prompt = map_prompt_template,
        verbose = False
    )

    output = summary_chain.run(input_documents=docs, objective=objective)

    return output

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