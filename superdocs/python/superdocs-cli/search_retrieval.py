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

from llama_index.schema import Node, QueryBundle, NodeWithScore
from llama_index import ServiceContext
from llama_index.llms import OpenAI

from ragatouille import RAGPretrainedModel

from .reranker import LLMReranker

import re

text_splitter = TokenTextSplitter(chunk_size=3000, chunk_overlap=500)
extractive_text_splitter = TokenTextSplitter(chunk_size=500, chunk_overlap=100)

def join_texts(texts: List[str]) -> str:
    return "\n\n".join(text for text in texts)

def extract_content(text, tag):
    pattern = r'<' + tag + '>(.*?)</' + tag + '>'
    matches = re.findall(pattern, text, re.DOTALL)
    return matches

def summary(objective, content, api_key, base_url, model_name):
    # try: 
    split_content = extractive_text_splitter.split_text(content)
    print(len(split_content), split_content[0])

    reranker = LLMReranker(api_key, base_url, model_name)
    snippets_with_score = reranker.rerank(split_content, objective, 7, 4)
    print("------------- EXTRACTED MOST RELEVANT CONTENT --------------")
    print("Received snippets with scores: ", snippets_with_score)

    return [f"Snippet extracted for objective: {objective} \n \n {snippet[0]}" for snippet in snippets_with_score]

def retrieve_content(question: str, api_key: str, base_url: str, model_name: str):
    # identify 
    results = search(question, num_results=2, advanced=True, timeout=5)
    combined_text = ""
    for result in results:
        response = requests.get(result.url)
        doc = Document(response.text)
        html_summary = doc.summary()
        combined_text += "\n\n" + md(html_summary)

    return summary(question, combined_text, api_key, base_url, model_name)    