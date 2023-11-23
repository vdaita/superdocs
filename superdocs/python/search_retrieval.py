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


model = ChatOpenAI()
text_splitter = TokenTextSplitter(chunk_size=10000, chunk_overlap=500)

# retrieval_function = {
#     "name": "retrieve_documentation_and_search",
#     "description": 
# }

summarize_prompt = PromptTemplate.from_template("The user is trying to answer this question: \"{question}\". Find and summarize the most relevant parts of the following context to do so. If nothing is relevant to the question, don't output anything. \n \n Context: {context} \n \n")
collapse_prompt = PromptTemplate.from_template("Collapse this content while still answering the following question: \"{question}\". \n \n Content: {content}")

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

def join_texts(texts: List[str]) -> str:
    return "\n\n".join(text for text in texts)


def retrieve_content(question: str):
    # identify 
    results = search(question, num_results=3, advanced=True, timeout=5)

    # Is summarization required?

    source_summaries = []
    model.max_tokens = 700
    for result in results:
        downloaded = fetch_url(result.url)
        content = extract(downloaded)
        
        if model.get_num_tokens(content) < 700:
            source_summaries.append(content)
            continue

        texts = text_splitter.split_text(content)
        for text in texts:
            # run summarization chain
            summary = summarization_chain.invoke({
                "question": question,
                "context": text
            })
            source_summaries.append(summary)


    # combine summaries in source_summaries recursively
        # create chunks of k token size, combine those, continue until it is small enough.
    combined_summaries = join_texts(source_summaries)
    while model.get_num_tokens(combined_summaries) > 4000:
        split_summaries = text_splitter.split_text(combined_summaries)
        source_summaries = []
        for summary in split_summaries:
            collapsed = collapse_chain.invoke({
                "question": question,
                "content": summary
            })
            source_summaries.append(collapsed)
        combined_summaries = join_texts(source_summaries)
    
    return combined_summaries    