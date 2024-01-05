from setuptools import setup

setup(
    name="superdocs-cli",
    version="0.0.1",
    install_requires=[
        "Flask==3.0.0",
        "Flask-Cors==4.0.0",
        "gitpython==3.1.37",
        "googlesearch-python==1.2.3",
        "langchain==0.0.352",
        "openai==1.6.0",
        "pydantic==1.10.13",
        "python-dotenv==1.0.0",
        "ripgrepy==2.0.0",
        "thefuzz==0.20.0",
        "tiktoken==0.4.0",
        "trafilatura==1.6.1",
        "typer[all]==0.9.0",
    ],
    scripts=["./superdocs-cli/__main__.py"],
    packages=["superdocs-cli"],
    zip_safe=False
)
