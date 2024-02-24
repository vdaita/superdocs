import React, {useState, useEffect} from 'react';
import './App.css';
import { Container, Card, Textarea, Group, Button, Box, Badge, Loader, Tabs, Text, Checkbox, TextInput, ScrollArea, Accordion, Paper} from "@mantine/core"
import EnhancedMarkdown from './lib/EnhancedMarkdown';

import MDEditor from '@uiw/react-md-editor';
import Replacement from './lib/Replacement';

let serverUrl = "http://127.0.0.1:8123/"

function App() {
  const [query, setQuery] = useState(""); // this should be the user's inputs
  const [snippets, setSnippets] = useState<string[]>([]); // these should be the snippets

  const [changes, setChanges] = useState([]);

  const [backendMessage, setBackendMessage] = useState("");
  const [currentVariable, setCurrentVariable] = useState({
    "name": "",
    "value": ""
  });

  const SPLIT_TOKEN = "------";

  let execute = async () => {
    let response = await fetch(`${serverUrl}/process`, {
      body: JSON.stringify({
        query: query,
        snippets: snippets
      })
    });
    let decoder = new TextDecoder();
    let reader = response.body!.getReader();

    while(true){
      const {done, value} = await reader.read();
      
      let newData = JSON.parse(decoder.decode(value));

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
      
      if(done){
        break;
      }
    }
  }

  let sendUpdate = async () => {
    let valueToSend = currentVariable["value"];
    if(currentVariable["name"] == "context"){
      valueToSend = changes.join(SPLIT_TOKEN);
    } else if (currentVariable["name"] === "changes") {
      let approvedString = "# Approve by running execute or change this value";
      if(currentVariable["value"] == approvedString) {
        valueToSend = "APPROVED";
      } else {
        valueToSend = "NOT";
      }
    }

    let response = await fetch(`${serverUrl}/send_response`, {
      body: JSON.stringify({
        "message": valueToSend
      })
    });

    if(response.ok){
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
      <MDEditor onChange={(e) => setQuery(e!)} value={query} placeholder="Query"></MDEditor>
      {snippets.map((item, index) => (
        <Box>
          <Button onClick={() => deleteSnippet(index)}>Delete Snippet</Button>
          <details>
            <summary>{item.split("\n")[0]}</summary>
            <MDEditor onChange={(e) => changeSnippetValue(e!, index)} value={item}/>
          </details>
        </Box>
      ))}

      <Button onClick={() => execute()}>Execute</Button>

      <Text>{backendMessage}</Text>
      {currentVariable["name"].length > 0 && <Box>
        <Text size="lg">{currentVariable["name"]}</Text>
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

