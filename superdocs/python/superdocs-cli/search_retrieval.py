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
    # try: 
    split_content = extractive_text_splitter.split_text(content)
    print(len(split_content), split_content[0])

    reranker = LLMReranker(api_key, base_url, model_name)
    snippets_with_score = reranker.rerank(split_content, objective, 7)
    print("------------- EXTRACTED MOST RELEVANT CONTENT --------------")
    print("Received snippets with scores: ", snippets_with_score)

    return f"# Extracted snippets for objective {objective} \n \n " + str(snippets_with_score)
    # llm = OpenAI(model=model_name, temperature=0, base_url=base_url, api_key=api_key)
    # service_context = ServiceContext.from_defaults(llm=llm, chunk_size=512)
    
    # query_bundle = QueryBundle(objective)
    # reranker = LLMRerank(
    #     choice_batch_size=5,
    #     top_n=7,
    #     service_context=service_context
    # )
    # retriever_nodes = reranker.postprocess_nodes(
    #     split_content_nodes, query_bundle
    # )

    # nodes_string = "\n".join([f"## Snippet {i}: {node.text}" for i, node in enumerate(retriever_nodes)])
    # return f"# Relevant snippets for {objective}: \n \n {nodes_string}"
    # except:
    #     RAG = RAGPretrainedModel.from_pretrained("colbert-ir/colbertv2.0")
    #     index = RAG.index(
    #         collection=[content],
    #         max_document_length=400,
    #         split_documents=True
    #     )
    #     results = index.search(query=objective, k=7)
    #     nodes_string = "\n".join([f"## Snippet {i}: {node['content']}" for i, node in enumerate(results)])
    #     return f"# Relevant snippets for {objective}: \n \n \n {nodes_string}"

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