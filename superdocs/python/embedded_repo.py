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
    return split_documents