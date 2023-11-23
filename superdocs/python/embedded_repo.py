from git import Repo
from langchain.document_loaders import GitLoader
from langchain.document_loaders.generic import GenericLoader
from langchain.document_loaders.parsers import LanguageParser
import os
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage, AIMessage, SystemMessage, Document
from langchain.prompts import PromptTemplate
from langchain.utils.openai_functions import convert_pydantic_to_openai_function
from dotenv import load_dotenv
import json
import time
from pydantic import BaseModel, Field

load_dotenv(".env")

gpt35 = ChatOpenAI(model="gpt-3.5-turbo", temperature=0)

# class DescribedSnippet(BaseModel):
#     """"""
#     start_line: int = Field("The start line of the code snippet, using zero-based indexing.")
#     end_line: int = Field("The end line of the code snippet, using zero-based indexing.")
#     keywords: int = Field("Keywords that can be used to search for this code snippet.")

# snippet_generation_prompt = PromptTemplate.from_template(
#     "Please take the input code and break it down into smaller chunks that are then summarized concisely."
# )

# function = convert_pydantic_to_openai_function(DescribedSnippet, description="")
# snippet_chain = (

# )

def refresh_local_documents(langchain_chroma):
    existing_documents = langchain_chroma.get()
    existing_files = {}

    # what are the excluded elements?
    for document in existing_documents:
        existing_files[document.metadata["source"]] = document.metadata["last_updated"]
    
    new_files = {}

    # when was this file last checked?
        # new files will definitely have modification dates after the currently stored time, but they aren't in the database



def get_documents(directory, ignore_file=".gitignore", no_gitignore=False, parser_threshold=5000):
    gitignore_path = os.path.join(directory, ignore_file)
    gitignore_rules = []
    if os.path.exists(gitignore_path):
        with open(gitignore_path, "w+") as f:
            lines = f.readlines()
            for line in lines:
                if len(line) > 0:
                    gitignore_rules.append(line)

    code_suffixes = [".py", ".js", ".jsx", ".tsx", ".ts", ".cc", ".hpp", ".cpp", ".c", ".rb"] # make a better list

    print("Following Gitignore Rules: ", gitignore_rules)

    loader = GenericLoader.from_filesystem(
        directory,
        glob="**/*",
        exclude=gitignore_rules,
        suffixes=code_suffixes,
        parser=LanguageParser(parser_threshold=parser_threshold)
    )

    documents = loader.load()

    text_splitter = RecursiveCharacterTextSplitter(chunk_size = 800, chunk_overlap = 100, length_function = len)
    split_documents = text_splitter.split_documents(documents)
    return split_documents # use the Bloop method of generating keywords on-query
    # writeup_documents = []
    # print("Number of documents: ", len(documents))
    # for i in range(len(documents)):
    #     code = documents[i].page_content

    #     # reform the below into a pydantic-based chain.


    #     summaries = gpt35([SystemMessage(content="""
    #     Please take the input file and, for chunks of code covering the entire file, output the following in the form of a JSON array: starting line (Attribute key: starting_line), ending line (Attribute key: ending_line), description of what the code between those lines does (Attribute key: description).  Please output in valid JSON.
    #     """), HumanMessage(content=code)])
    #     print(str(i) + ":", summaries.content)
    #     content = summaries.content
    #     content = summaries.content.replace("```json", "")
    #     content = summaries.content.replace("```", "")

    #     codebase_split = code.split("\n")

    #     loaded_content = json.loads(content)
    #     for chunk in len(loaded_content):
    #         code_lines = "\n".join(codebase_split[chunk.metadata["starting_line"]:chunk.metadata["ending_line"]])
    #         document = Document(
    #             page_content=f"""
    #             Filename: {documents[i].metadata["source"]}
    #             Description: {chunk["description"]}
    #             Code: {code_lines}
    #             """,
    #             metadata={
    #                 "source": documents[i].metadata["source"],
    #                 "starting_line": chunk.metadata["starting_line"],
    #                 "ending_line": chunk.metadata["ending_line"],
    #                 "last_updated": time.time()
    #             }
    #         )
    #         writeup_documents.append(document)
    # return writeup_documents