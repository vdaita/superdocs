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

def summary(objective, content):
    llm = ChatOpenAI(temperature = 0, model = "gpt-3.5-turbo-16k-0613") # TODO: Switch to Mistral

    text_splitter = RecursiveCharacterTextSplitter(separators=["\n\n", "\n"], chunk_size = 10000, chunk_overlap=500)
    docs = text_splitter.create_documents([content])
    
    map_prompt = """
    Write a summary of the following text for {objective}:
    "{text}"
    SUMMARY:
    """
    map_prompt_template = PromptTemplate(template=map_prompt, input_variables=["text", "objective"])
    
    summary_chain = load_summarize_chain(
        llm=llm, 
        chain_type='map_reduce',
        map_prompt = map_prompt_template,
        combine_prompt = map_prompt_template,
        verbose = False
    )

    output = summary_chain.run(input_documents=docs, objective=objective)

    return output

def retrieve_content(question: str):
    # identify 
    results = search(question, num_results=3, advanced=True, timeout=5)
    combined_text = ""
    for result in results:
        downloaded = fetch_url(result.url)
        combined_text += "\n" + extract(downloaded)

    return summary(combined_text, question)    