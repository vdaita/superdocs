import React, {useState, useEffect} from 'react';
import './App.css';
import { Container, Card, Textarea, Group, Button, Box, Loader, Tabs, Text, ScrollArea } from "@mantine/core"
import { VSCodeMessage } from './lib/VSCodeMessage';
import EnhancedMarkdown from './lib/EnhancedMarkdown';
import { Message } from './lib/Message';
import { Snippet } from './lib/Snippet';
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter';
import { dark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import axios, { all } from 'axios';
import ReactJson from 'react-json-view';


function App() {

  const [message, setMessage] = useState("");

  const [loading, setLoading] = useState(false);
  const [responseCallback, setResponseCallback] = useState(() => {});

  const [messages, setMessages] = useState<Message[]>([]);

  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [hidden, setHidden] = useState<boolean[]>(Array(1000).fill(false));
  
  const [sources, setSources] = useState<any[]>([]);

  const [allSnippets, setAllSnippets] = useState<Snippet[]>([]);
  const [directory, setDirectory] = useState("");

  useEffect(() => {
    VSCodeMessage.onMessage((message) => {
      // console.log("Received message: ", message)
      let content = message.data.content;
      let type = message.data.type;
      console.log(content, type);
      if(type == "messages"){
        console.log("Messages: ", content);
        setMessages(content);
        if(content.length > 0){
          setLoading(true);
        } else {
          setLoading(false);
        }
      } else if (type == "snippet") {
        setSnippets((existingArray) => [...existingArray, content]);
        setAllSnippets((existingArray) => [...existingArray, content]);
      } else if (type == "responseRequest") {
        requestUserResponse();
      } else if (type == "info") {
        setDirectory(content["directory"]);
      }
    });
  }, []);

  let requestUserResponse = () => {
    setLoading(false);
  }

  let sendMessage = async (message: string, type: string) => {
    let localMessages = [...messages];
    try {
      let fullMessage = message;
      if(snippets.length > 0){
        fullMessage += "\n ### Code snippets: \n"
        for(var i = 0; i < snippets.length; i++){
          fullMessage += "Filepath: " + snippets[i].filepath + "\n\n";
          fullMessage += "```" + snippets[i].language + "\n" + snippets[i].code + "\n```\n";
        }
      }
  
      setMessage("");
      setSnippets([]);
      setLoading(true);

      localMessages.push({
        role: "user",
        content: fullMessage
      });

      setMessages(localMessages);
  
      console.log("Sending message to backend.");
      
      let withoutHiddenMessages = [];
      for(var i = 0; i < localMessages.length; i++){
        if(!hidden[i]){
          withoutHiddenMessages.push(localMessages[i]);
        }
      }

      let result = await axios.post(`http://127.0.0.1:5000/${type}`, {
        "messages": withoutHiddenMessages,
        "directory": directory
      }, {
        headers: {
          'Content-Type': "application/json;charset=UTF-8"
        }
      });

      console.log("Result from retrieval attempt: ", result);
      if(result.data){
        localMessages = [...localMessages, ...result.data];
      } else {
        localMessages = [...localMessages,  {role: "assistant", content: "There was an error"}];
      }
  
      setMessages(localMessages);
      setLoading(false);
    } catch(e) {
      console.error(e);
      localMessages = [...localMessages, {role: 'assistant', content: "There was an error"}];
      setMessages(localMessages)
      setLoading(false);
    }
  }

  let makeElementHidden = (index: number) => {
    let tempHidden = [...hidden];
    tempHidden[index] = !tempHidden[index];
    setHidden(tempHidden);
  }

  let snippetsWithoutIndex = (arr: Snippet[], index: number) => {
    if (index < 0 || index >= arr.length) {
      return arr;
    }
    return arr.filter((_, i) => i !== index);
  }
  
  let deleteSnippet = (index: number) => {
    setSnippets((oldArray) => snippetsWithoutIndex(oldArray, index));

    // find matching
    let allSnippetsMatchingIndex = -1;
    for(var i = 0; i < allSnippets.length; i++){
      if(allSnippets[i].code === snippets[index].code){
        allSnippetsMatchingIndex = i;
        break;
      }
    }

    setAllSnippets((oldArray) => snippetsWithoutIndex(oldArray, index));
  }

  let getSources = async () => {}
  let reloadLocalCodebase = async () => {}


  let resetMessages = async () => {
    setMessages([]);
    setHidden(Array(1000).fill(false));
  }

  return (
    <Container py='lg' px='md'>
      <Tabs defaultValue="chat">
        <Tabs.List>
          <Tabs.Tab value="chat">Chat</Tabs.Tab>
          {/* <Tabs.Tab value="sources">Sources</Tabs.Tab> */}
        </Tabs.List>
      
        <Tabs.Panel value="chat">
          <Box m="lg">
            <Text>Currently in directory: {directory}</Text>

            {messages.length > 0 && <Button variant="filled" onClick={() => resetMessages()}>Reset conversation</Button>}

            {messages.map((item, index) => (
                <Card shadow="sm" m={4} key={index}>
                  <ScrollArea>
                    {(item.content) && <EnhancedMarkdown message={item} hidden={hidden[index]} unhide={() => makeElementHidden(index)}/>}
                  </ScrollArea>
                </Card>
              ))}

            
            <Text m="sm" size="xs">Press Enter to send and Shift-Enter for newline.</Text>
            <Textarea placeholder="Provide feedback" disabled={loading} value={message} onChange={(e) => setMessage(e.target.value)}/>
            
            <Box>
              <Button variant="outline" size="xs" disabled={loading} onClick={() => sendMessage(message, "information")}>➡️ Load Further Context</Button>
              <Button variant="outline" size="xs" disabled={loading} onClick={() => sendMessage(message, "plan")}>➡️ Create Plan</Button>
              <Button variant="outline" size="xs" disabled={loading} onClick={() => sendMessage(message, "execute")}>➡️ Implement Instructions</Button>
            </Box>

            {snippets.map((item, index) => (
              <Card shadow="sm" key={index}>
                <ScrollArea>
                  <Text>Filepath: {item.filepath}</Text>
                  <SyntaxHighlighter language={item.language} style={dark}>
                    {item.code}
                  </SyntaxHighlighter>
                </ScrollArea>
                <Button variant="outline" onClick={() => deleteSnippet(index)}>Delete</Button>
              </Card>
            ))}

          </Box>
        </Tabs.Panel>

        <Tabs.Panel value="sources">
          <Box m="lg">
            <Button disabled={loading} onClick={() => getSources()} m="sm">Check sources</Button>
            <Button disabled={loading} onClick={() => reloadLocalCodebase()} m="sm">Load/reload local codebase</Button>

            {loading && <Loader/>}
          
            {sources.map((item, index) => (
              <ReactJson theme="hopscotch" src={item} collapsed={true}/>
            ))}
          </Box>
        </Tabs.Panel>

      </Tabs>

      {/* <Text>{JSON.stringify(snippets)}</Text> */}
    </Container>
  );
}

export default App;
