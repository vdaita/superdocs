from git import Repo
from langchain.document_loaders import GitLoader
from langchain.document_loaders.generic import GenericLoader
from langchain.document_loaders.parsers import LanguageParser
import os
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage, AIMessage, SystemMessage, Document
from dotenv import load_dotenv
from kor import create_extraction_chain, Object, Text

load_dotenv(".env")

gpt35 = ChatOpenAI(model="gpt-3.5-turbo", temperature=0.2)

def get_documents(directory, ignore_file=".gitignore", no_gitignore=False, parser_threshold=500):
    gitignore_path = os.path.join(directory, ignore_file)
    gitignore_rules = []
    if os.path.exists(gitignore_path):
        with open(gitignore_path, "w+") as f:
            lines = f.readlines()
            for line in lines:
                if len(line) > 0:
                    gitignore_rules.append(line)

    code_suffixes = [".py", ".js", ".jsx", ".tsx", ".cc", ".hpp", ".cpp", ".c", ".rb"] # make a better list

    loader = GenericLoader.from_filesystem(
        directory,
        glob="*",
        exclude=gitignore_rules,
        suffixes=code_suffixes,
        parser=LanguageParser(parser_threshold=parser_threshold)
    )

    documents = loader.load()

    schema = Object(
        id="snippets",
        description=""
    )

    chain = create_extraction_chain(gpt35, schema, encoder_or_encoder_class="json")

    split_documents = []

    for i in range(len(documents)):
        results = chain.predict_and_parse(text=documents[i].page_content)['data']
        for result in results:
            split_documents.append(results)


    # text_splitter = RecursiveCharacterTextSplitter(chunk_size = 800, chunk_overlap = 100, length_function = len)
    # split_documents = text_splitter.split_documents(documents)
    # writeup_documents = []
    # print("Split documents: ", len(split_documents))
    # for i in range(len(split_documents)):
    #     code = split_documents[i].page_content
    #     writeup = gpt35([SystemMessage(content="Write a short, 1 sentence, description of what this chunk of code does. Use variable and function names as much as possible."), HumanMessage(content=code)])
    #     print(str(i) + ":", writeup.content)
    #     new_metadata = split_documents[i].metadata
    #     new_metadata["code"] = code

    #     new_document = Document(
    #         page_content=writeup.content,
    #         metadata=new_metadata
    #     )

    #     writeup_documents.append(new_document)
    # return writeup_documents