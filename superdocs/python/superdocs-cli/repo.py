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

def get_documents(directory, ignore_file=".gitignore", no_gitignore=False, parser_threshold=1000):
    files = list_non_ignored_files(directory)
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


    all_docs = []

    print("Going into the for loop")

    for rfilepath in files:
        ext = rfilepath.split(".")[-1]
        print("Processing filepath: ", rfilepath, ext, ext in code_suffixes)
        if ext in code_suffixes:
            print("         Code suffixes work")
            filepath = os.path.join(directory, rfilepath)
            print("Loading: ", filepath)
            file = open(filepath, "r")
            contents = file.read()
            file.close()      
            
            code_splitter = CodeSplitter(language=language_map[ext])
            split_text = code_splitter.split_text(contents)

            all_docs.extend(Node(text=f"Filename: {rfilepath} \n Content: {text}") for text in split_text)
            print("Finished.")
   
    return all_docs

if __name__ == "__main__":
    print("Main")
    # print(get_documents("/Users/vijaydaita/Files/uiuc/rxassist/rxassist/"))