# from llama_hub.web.sitemap import SitemapReader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.schema import Document
from googlesearch import search
from trafilatura import extract, fetch_url
import uuid

# def load_website_sitemap(sitemap_url, filter_url=None):
#     loader = SitemapReader()
#     text_splitter = RecursiveCharacterTextSplitter()
#     try:
#         documents = []
#         if filter_url:
#             documents = loader.load_data(sitemap_url=sitemap_url, filter_url=filter_url)
#         else:
#             documents = loader.load_data(sitemap_url=sitemap_url)

#     except Exception as e:
#         return [];  

def load_website_google(base_url):
    text_splitter = RecursiveCharacterTextSplitter()
    websites = search("site:" + base_url, advanced=True, sleep_interval=5, num_results=100)
    
    all_documents = []

    for website in websites:
        # load the URL at url and chunk it into reasonable sizes
        downloaded = fetch_url(website.url)
        extraction = extract(downloaded)
        document = Document(page_content=extraction, metadata={
            "source": website.url,
            "title": website.title
        })
        split_documents = text_splitter.split_documents([document])
        # for i in range(len(split_documents)):
        #     split_documents[i].metadata["id"] = str(uuid.uuid4())
        
        all_documents.extend(split_documents)
    
    return all_documents