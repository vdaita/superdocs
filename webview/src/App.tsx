import React, {useState, useEffect} from 'react';
import './App.css';
import { Container, Card, Textarea, Title, Group, Button, Box, Badge, Loader, Tabs, Text, Checkbox, TextInput, ScrollArea, Accordion, Paper} from "@mantine/core"
import EnhancedMarkdown from './lib/EnhancedMarkdown';

import MDEditor from '@uiw/react-md-editor';
import Replacement from './lib/Replacement';
import { VSCodeMessage } from './lib/VSCodeMessage';
import { toast } from 'react-toastify';
import axios from 'axios';

let serverUrl = "http://127.0.0.1:8125/"

function App() {
  const [query, setQuery] = useState("# Query"); // this should be the user's inputs
  const [snippets, setSnippets] = useState<string[]>([]); // these should be the snippets

  const [changes, setChanges] = useState([]);

  const [backendMessage, setBackendMessage] = useState("");
  const [currentVariable, setCurrentVariable] = useState({
    "name": "",
    "value": ""
  });

  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [directory, setDirectory] = useState("");

  const SPLIT_TOKEN = "------";

  useEffect(() => {
    VSCodeMessage.onMessage((message) => {
      console.log("Received message: ", message)
      let content = message.data.content;
      let type = message.data.type;
      if (type == "snippet") {
        const directory = content.directory;
        let relativeFilepath = content.filepath.replace(directory, "");
        if(relativeFilepath.startsWith("/")) {
          relativeFilepath = relativeFilepath.substring(1, relativeFilepath.length);
        }

        let snippetText = `Filepath: ${relativeFilepath} \n \`\`\`${content.language} \n ${content.code} \n \`\`\``;

        console.log("Received snippet with information: ", directory, relativeFilepath, snippetText, directory)
        setSnippets([...snippets, snippetText]);
        setDirectory(directory);
      }
    });
  }, []);

  let execute = async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const stringifiedSnippets = snippets.join("\n" + SPLIT_TOKEN + "\n");

      let response = await fetch(`${serverUrl}/process`, {
          body: JSON.stringify({
            directory: directory,
            objective: query,
            snippets: stringifiedSnippets
          }),
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        },
      );
  
      if(!(response.status == 200)) {
        setErrorMessage(`${response.status}: ${response.statusText}`);
        setLoading(false);
      }
  
      let decoder = new TextDecoder();
      let reader = response.body!.getReader();
  
      while(true){
        const {done, value} = await reader.read();
        const decodedValue = decoder.decode(value);
        let chunks = decodedValue.split("<sddlm>");

        console.log("Received values: ", done, chunks);
        
        chunks.map((chunk) => { // wrap in a try-except

          if(chunk.length < 5){
            return;
          }

          let newData = JSON.parse(chunk);
  
          if(newData["type"] === "information"){
            setBackendMessage(backendMessage + "\n" + newData["content"]);
          } else if (newData["type"] === "context") {
            let generatedContext = newData["content"].split(SPLIT_TOKEN);
            setSnippets(generatedContext);
            setCurrentVariable({
              "name": "context",
              "value": "# Send approved context"
            });
          } else if (newData["type"] === "plan") {
            setCurrentVariable({
              "name": "plan",
              "value": newData["content"]
            });
          } else if (newData["type"] === "changes") {
            setChanges(newData["content"]);
            setCurrentVariable({
              "name": "changes",
              "value": "# Approve by running execute or change this value"
            });
          }
        })
        
        if(done){
          break;
        }
      } 
    } catch (e) {
      console.error(e);
      setErrorMessage("There was an error.");
    }

    setLoading(false);
  }

  let sendUpdate = async () => {
    let valueToSend = currentVariable["value"];
    if(currentVariable["name"] == "context"){
      const stringifiedSnippets = snippets.join("\n" + SPLIT_TOKEN + "\n");
      valueToSend = stringifiedSnippets;
    } else if (currentVariable["name"] === "changes") {
      let approvedString = "# Approve by running execute or change this value";
      if(currentVariable["value"] == approvedString) {
        valueToSend = "APPROVED";
      } else {
        valueToSend = "NOT";
      }
    }

    console.log("Sending information: ", valueToSend);

    let response = await axios.post(`${serverUrl}/send_response`, {
      "message": valueToSend
    });

    if(response.status == 200){
      console.log("The current statement has been processed by the backend.");
      setCurrentVariable({
        name: "",
        value: ""
      });
      setBackendMessage(backendMessage + "\nYour update has successfully been sent.");
    }
  }


  // Snippet management
  let snippetWithoutIndex = (arr: string[], index: number) => {
    if (index < 0 || index >= arr.length) {
      return arr;
    }
    return arr.filter((_, i) => i !== index);
  }

  let deleteSnippet = (index: number) => {
    const newContext = snippetWithoutIndex(snippets, index);
    setSnippets(newContext);
  }

  let changeSnippetValue = (item: string, index: number) => {
    let tempValue = [...snippets];
    tempValue[index] = item;
    setSnippets(tempValue);
  }


  return (
    <Container>
      {!directory.length && <Text>Send a snippet to set the current working directory of your editor.</Text>}

      {directory.length && <Text>Current directory: {directory}</Text>}

      <MDEditor onChange={(e) => setQuery(e!)} value={query}></MDEditor>
      <Button onClick={() => execute()}>Execute</Button>

      <Title order={1}>Snippets</Title>
      {snippets.length == 0 && <Text>No snippets have been added yet. Add a snippet for us to be able to establish your current directory.</Text>}
      {snippets.map((item, index) => (
        <Card shadow="sm" padding="lg" radius="md" withBorder>
          <details>
            <Button onClick={() => deleteSnippet(index)} variant="outline" mb='sm'>Delete Snippet</Button>
            <summary>{item.trimStart().split("\n")[0]}</summary>
            <MDEditor onChange={(e) => changeSnippetValue(e!, index)} value={item}/>
          </details>
        </Card>
      ))}

      {errorMessage && <Card shadow="sm" padding="lg" radius="md" withBorder bg="red">
        {errorMessage}
      </Card>}

      {loading && <Card>
        Superdocs is loading...
      </Card>}


      <Text>{backendMessage}</Text>
      {currentVariable["name"].length > 0 && <Box>
        <Text size="xl" fw={700}>{currentVariable["name"]}</Text>
        <MDEditor 
          value={currentVariable["value"]} 
          onChange={(e) => setCurrentVariable({...currentVariable, "value": e!})}>
        </MDEditor>
        <Button onClick={() => sendUpdate()}>Send update</Button>
      </Box>}

      {changes.map((item, index) => (
        <Replacement
          content={item}
        />
      ))}
    </Container>
  )
}

export default App;

