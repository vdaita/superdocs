# Load repos into db from github

import superdocs/python/main.py as mp
import re
from github import Github  # Using PyGitHub
from chromadb import ChromaDB  # Hypothetical database library
from langchain.schema.document import Document  # Hypothetical Langchain document class

def process_github_repo(url):
    try:
        # Parse the GitHub repository URL to extract the owner and repository name
        owner, repo_name = __parse_github_url(url)
        
        # Access the GitHub repository
        github = Github("YOUR_GITHUB_ACCESS_TOKEN")  # Replace with your GitHub token
        repository = github.get_repo(f"{owner}/{repo_name}")

        # Initialize an array to hold Langchain documents
        langchain_documents = []

        # Initialize a list to hold document content
        document_contents = []

        # Iterate over all files in the repository
        for content_file in repository.get_contents(""):
            if content_file.type == "file":
                # Process the file content
                file_content = content_file.decoded_content

                metadata={'source_url': url}

                # Create a Langchain Document object
                langchain_doc = Document(
                    page_content=file_content,
                    lookup_str='',  # Add a lookup string if needed
                    metadata=metadata
                )
                langchain_documents.append(langchain_doc)

                document_contents.append(file_content)

        # Store all Langchain documents in ChromaDB
        mp.client.store_documents(langchain_documents)

        return langchain_documents
    except Exception as e:
        print(f"An error occurred: {str(e)}")
        return None

def __parse_github_url(url):
    # Parse the GitHub repository URL to extract the owner and repository name
    # You may need to adapt this function based on the URL format you expect
    parts = url.split("/")
    if len(parts) >= 2:
        owner, repo_name = parts[-2], parts[-1]
        return owner, repo_name
    else:
        return None, None

def is_github_repo(url):
    # Define a regular expression pattern for a GitHub repository URL
    github_repo_pattern = r'^https://github\.com/[\w-]+/[\w-]+$'
    
    # Use the `re.match` function to check if the URL matches the pattern
    return re.match(github_repo_pattern, url) is not None