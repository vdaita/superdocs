from git import Repo
from langchain.document_loaders import GitLoader
from langchain.document_loaders.generic import GenericLoader
from langchain.document_loaders.parsers import LanguageParser
import os
from tree_sitter import Language, Parser

from dotenv import load_dotenv

load_dotenv(".env")


def get_repo_summary(directory, ignore_file=".gitignore", no_gitignore=False, parser_threshold=500):
    gitignore_path = os.path.join(directory, ignore_file)
    gitignore_rules = []
    if os.path.exists(gitignore_path):
        with open(gitignore_path, "w+") as f:
            lines = f.readlines()
            for line in lines:
                if len(line) > 0:
                    gitignore_rules.append(line)

    code_suffixes = {
        "py": "python",
        "js": "javascript",
        "jsx": "javascript",
        "ts": "typescript",
        "tsx": "typescript"
    }

    # [".py", ".js", ".jsx", ".tsx", ".cc", ".hpp", ".cpp", ".c", ".rb"] # make a better list
    code_extensions = ["." + key for key in list(code_suffixes.keys())]

    loader = GenericLoader.from_filesystem(
        directory,
        glob="*",
        exclude=gitignore_rules,
        suffixes=code_extensions,
        parser=LanguageParser(parser_threshold=parser_threshold)
    )

    documents = loader.load()

    for document in documents:
        # figure out the source url
        filepath = document.metadata["source_url"] # figure out if this is it
