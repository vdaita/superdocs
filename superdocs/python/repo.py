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
import subprocess
from thefuzz import process

load_dotenv(".env")
def refresh_local_documents(langchain_chroma):
    existing_documents = langchain_chroma.get()
    existing_files = {}
    for document in existing_documents:
        existing_files[document.metadata["source"]] = document.metadata["last_updated"]
    
    new_files = {}

def find_closest_file(directory, filepath):
    files = list_non_ignored_files(directory)
    closest_match = process.extractOne(filepath, files)
    if closest_match[1] < 90:
        return None
    else:
        print("Found closest file: ", directory, filepath)
        return closest_match[0]

def list_non_ignored_files(directory):
    code_suffixes = [".py", ".js", ".jsx", ".tsx", ".ts", ".cc", ".hpp", ".cpp", ".c", ".rb"] # make a better list
    find_command = f"cd {directory} && git ls-files --exclude-standard && git ls-files --exclude-standard -o"
    result = subprocess.run(find_command, shell=True, check=True, text=True, capture_output=True)
    non_ignored_files = result.stdout.splitlines()

    print("Found non_ignored_files output: ", non_ignored_files)

    # suffix_non_ignored_files = [] - BUGGY
    # for filepath in non_ignored_files:
    #     ext = filepath.split(".")[-1]
    #     if ext in code_suffixes:
    #         suffix_non_ignored_files.append(filepath)

    # print("Found non_ignored_files: ", suffix_non_ignored_files)

    return non_ignored_files

def get_documents(directory, ignore_file=".gitignore", no_gitignore=False, parser_threshold=1000):
    gitignore_path = os.path.join(directory, ignore_file)
    gitignore_rules = []
    if os.path.exists(gitignore_path):
        with open(gitignore_path, "r") as f:
            lines = f.readlines()
            for line in lines:
                if len(line) > 0:
                    gitignore_rules.append(line.strip())

    code_suffixes = [".py", ".js", ".jsx", ".tsx", ".ts", ".cc", ".hpp", ".cpp", ".c", ".rb"] # make a better list

    print("Following Gitignore Rules: ", gitignore_rules)

    loader = GenericLoader.from_filesystem(
        directory,
        glob="**/*",
        exclude=gitignore_rules,
        suffixes=code_suffixes,
        parser=LanguageParser(parser_threshold=parser_threshold)
    ) # add a random check that if a file is longer than k, it should not be included in the file.

    documents = loader.load()

    text_splitter = RecursiveCharacterTextSplitter(chunk_size = 800, chunk_overlap = 100, length_function = len)
    split_documents = text_splitter.split_documents(documents)
    return split_documents

if __name__ == "__main__":
    print("Main")
    list_non_ignored_files("/Users/vijaydaita/Files/uiuc/rxassist/rxassist/")