import superdocs/python/main.py as mp
from langchain.document_loaders import WebBaseLoader

from langchain.schema import Document

def fetch_webpage_and_store_in_chromadb(url):
    try:
        # Create a WebBaseLoader for the specified URL
        loader = WebBaseLoader(url)

        # To bypass SSL verification errors during fetching, you can set the "verify" option:
        loader.requests_kwargs = {'verify': False}

        # Fetch content from the webpage
        data = loader.load()

        if data:
            # Extract the content from the Langchain document
            content = data[0].page_content

            # Optionally, you can extract other metadata from the Langchain document
            metadata = {'source_url': url}

            # Create a Langchain document with the content and metadata
            langchain_document = Document(
                page_content=content,
                lookup_str='',  # Add a lookup string if needed
                metadata=metadata,
            )

            # Store the Langchain document in your ChromaDB
            mp.client.add(langchain_document)

            return True
        else:
            return False

    except Exception as e:
        print(f"An error occurred: {str(e)}")
        return False