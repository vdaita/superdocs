from git import Repo
import os
from dotenv import load_dotenv
import json
import time
from pydantic import BaseModel, Field
import subprocess
from thefuzz import process, fuzz
from llama_index.node_parser import CodeSplitter
from llama_index.schema import Node

from openai import OpenAI
from .prompts import CODE_SPLIT_PROMPT
import re
import json

code_suffixes = ["py", "js", "jsx", "tsx", "ts", "cc", ".hpp", ".cpp", ".c", ".rb"] # make a better list
language_map = {
    "py": "python",
    "js": "javascript",
    "java": "java",
    "ts": "typescript",
    "tsx": "typescript",
    "jsx": "javascript",
    "cc": "cpp",
    "hpp": "cpp",
    "cpp": "cpp",
    "rb": "ruby"
}


def extract_json_code_data(md_text):
   # Regular expression pattern for matching diff code blocks
   pattern = r'```json([\s\S]*?)```'
   # Find all diff code blocks using the pattern
   diff_code_blocks = re.findall(pattern, md_text, re.MULTILINE)
   return diff_code_blocks

 
def find_closest_file(directory, filepath, threshold=95):
    files = list_non_ignored_files(directory)
    closest_match = process.extractOne(filepath, files, scorer=fuzz.token_sort_ratio)
    print("find_closest_file: closest_match: ", closest_match)
    if closest_match[1] < threshold:
        return filepath
    else:
        print("Found closest file in find_closest_file: ", directory, filepath, closest_match[0])
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

def get_documents(directory, api_key, model_name, api_url):
    files = list_non_ignored_files(directory)
    all_docs = []

    model = OpenAI(api_key, model_name=model_name, base_url=api_url)

    for rfilepath in files:
        ext = rfilepath.split(".")[-1]
        print("Processing filepath: ", rfilepath, ext, ext in code_suffixes)
        if ext in code_suffixes:
            filepath = open(directory, rfilepath)
            try:
                file = open(filepath, "r")
                contents = file.read()
                file.close()

                try:
                    messages = [{
                        "role": "system",
                        "content": CODE_SPLIT_PROMPT
                    }, {
                        "role": "human",
                        "content": contents
                    }]
                    response = model.chat.completions.create(
                        model=model_name,
                        messages=messages,
                        max_tokens=512
                    )
                    response = response.choices[0].message.content
                    lines = contents.split("\n")

                    response = json.loads(extract_json_code_data(response)[0])
                    docs = []
                    for chunk in response:
                        chunk['end'] = max(chunk['end'], len(lines) - 1) # about what the final index, inclusive should be
                        code_snippet = '\n'.join(lines[chunk['start']:chunk['end'] + 1])
                        docs.append(
                            Node(text=f"Filename: {rfilepath} \n Description: {chunk['description']} \n Code: {code_snippet}")
                        )
                    all_docs.extend(docs)
                    # This should be an iterable JSON array
                except:
                    # Use the regular code splitter document creation
                    all_docs.extend(get_code_splitter_docs_from_file(contents, rfilepath))
            except:
                print("File could not be properly found or opened.")

def get_code_splitter_docs_from_file(contents, rfilepath):
    extension = rfilepath.split(".")[-1]
    code_splitter = CodeSplitter(language=language_map[extension])
    split_text = code_splitter.split_text(contents)
    return [Node(text=f"Filename: {rfilepath} \n Content: {text}") for text in split_text]

def get_documents_regular_splitter(directory, ignore_file=".gitignore", no_gitignore=False, parser_threshold=1000):
    files = list_non_ignored_files(directory)
    all_docs = []

    print("Going into the for loop")

    for rfilepath in files:
        ext = rfilepath.split(".")[-1]
        print("Processing filepath: ", rfilepath, ext, ext in code_suffixes)
        if ext in code_suffixes:
            print("         Code suffixes work")
            filepath = os.path.join(directory, rfilepath)
            print("Loading: ", filepath)

            try:
                file = open(filepath, "r")
                contents = file.read()
                file.close()      

                all_docs.extend(get_code_splitter_docs_from_file(contents, rfilepath))
                print("Finished.")
            except:
                print("Either the file doens't exist or there was an error.")
   
    return all_docs

if __name__ == "__main__":
    print("Main")
    # print(get_documents("/Users/vijaydaita/Files/uiuc/rxassist/rxassist/"))