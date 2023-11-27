"""
The goal of this is to get information from the codebase, web, and local documentation, and combining the information in them to find the most condensed information that solves the question the user has.
"""

from functools import partial
from typing import List

from langchain.chat_models import ChatOpenAI
from googlesearch import search
from trafilatura import fetch_url, extract
import tiktoken
from langchain.text_splitter import TokenTextSplitter
from langchain.prompts import PromptTemplate
from langchain.schema import StrOutputParser


text_splitter = TokenTextSplitter(chunk_size=10000, chunk_overlap=500)

# retrieval_function = {
#     "name": "retrieve_documentation_and_search",
#     "description": 
# }

summarize_prompt = PromptTemplate.from_template("The user is trying to answer this question: \"{question}\". Find and summarize the most relevant parts of the following context to do so. If nothing is relevant to the question, output NOTHING RELEVANT. \n \n Context: {context} \n \n")
collapse_prompt = PromptTemplate.from_template("Collapse this content while still answering the following question: \"{question}\". \n \n Content: {content}")

def join_texts(texts: List[str]) -> str:
    return "\n\n".join(text for text in texts)

def summarize_relevantly(text: str, question: str, model: str) -> str:
    summarization_chain = (
        summarize_prompt | 
        model |
        StrOutputParser()
    ).with_config(run_name="Summarization")

    collapse_chain = (
        collapse_prompt | 
        model |
        StrOutputParser()
    ).with_config(run_name="Collapsing")

    while model.get_num_tokens(text) < 2000:
        chunks = text_splitter.split_text(text)
        summaries = [summarization_chain.invoke({"question": question, "content": chunk}) for chunk in chunks]
        joined_summaries = join_texts(summaries)
        collapsed = collapse_chain.invoke({"question": question, "content": joined_summaries})
        text = collapsed

    return text