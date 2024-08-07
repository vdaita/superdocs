const url = 'http://0.0.0.0:8000/edit_request';

const data = {
    "file_content": "string",
    "query": "string"
};

const options = {
    method: 'POST',
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
};

fetch(url, options)
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));