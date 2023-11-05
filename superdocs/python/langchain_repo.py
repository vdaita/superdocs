from git import Repo
from langchain.document_loaders import GitLoader
from langchain.document_loaders.generic import GenericLoader
from langchain.document_loaders.parsers import LanguageParser
import os

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

    return loader.load()