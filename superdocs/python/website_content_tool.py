from trafilatura import fetch_url, extract
from langchain.tools import BaseTool, StructuredTool, Tool, tool

@tool("get_website_content", return_direct=True)
def get_website_content(url: str) -> str:
    """Extracts the text from the url queried."""
    downloaded = fetch_url(url)
    result = extract(downloaded)
    return result