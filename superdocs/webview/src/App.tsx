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
import { notifications } from "@mantine/notifications";


function App() {

  const [message, setMessage] = useState("");

  const [errorMessage, setErrorMessage] = useState("");

  const [loading, setLoading] = useState(false);
  const [serverData, setServerData] = useState("");

  const [messages, setMessages] = useState<Message[]>([]);

  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [replaceSnippets, setReplaceSnippets] = useState<Snippet[]>([]);
  
  const [sources, setSources] = useState<any[]>([]);

  useEffect(() => {
    VSCodeMessage.onMessage((message) => {
      // console.log("Received message: ", message)
      let content = message.data.content;
      let type = message.data.type;
      console.log(content, type);
      if(type == "messages"){
        console.log("Messages: ", content);
        setMessages(content);
      } else if (type == "snippets") {
        // console.log("Current snippets: ", snippets, " new contents: ", content);
        setSnippets(content);
      } else if (type == "responseRequest") {
        requestUserResponse();
      } else if  (type == "serverData") {
        setServerData(content);
      }
    });
  }, []);

  let requestUserResponse = () => {
    setLoading(false);
  }

  let sendMessage = async (message: string) => {
    let fullMessage = message;
    if(snippets.length > 0){
      fullMessage += "\n ### Code snippets: \n"
      for(var i = 0; i < snippets.length; i++){
        if(snippets[i].isCurrent){
          fullMessage += "In file " + snippets[i].filepath + ": \n";
          fullMessage += "```" + snippets[i].language + "\n" + snippets[i].code + "\n```\n";
        }
      }
    }

    if(messages.length === 0){
      resetSnippetsAndMessage();

      let result = await axios.post('http://127.0.0.1:54323/initiate_chat', {
        "message": fullMessage
      }, {
        headers: {
          'Content-Type': "application/json;charset=UTF-8"
        }
      });

      if(!result.data["ok"]){
        notifications.show({
          title: "There was an error initializing the chat",
          message: "Error"
        })
      }

      return;
    }

    VSCodeMessage.postMessage({
      type: "response",
      content: fullMessage
    });
    resetSnippetsAndMessage();
  }

  let resetSnippetsAndMessage = () => { 
    VSCodeMessage.postMessage({
      type: "setSnippetsToPast"
    });
    setMessage("");
  }
  
  let deleteSnippet = (index: number) => {
    VSCodeMessage.postMessage({
      type: "deleteSnippet",
      content: {
        index: index
      }
    });
  }

  let getSources = async () => {
    setLoading(true);
    let sources = await axios({
      method: "get",
      url: "http://127.0.0.1:54323/get_sources"
    });

    console.log("Sources data: ", sources.data);

    let data = sources.data;
    setSources(data);
    setLoading(false);
  }

  let reloadLocalCodebase = async () => {
    console.log("Running reloadLocalCodebase");
    setLoading(true);
    try {
      let res = await axios({
        method: "post",
        url: "http://127.0.0.1:54323/reload_local_sources"
      });

      if(!res.data["ok"]){
        notifications.show({
          title: "There was an error initializing the chat",
          message: "Error"
        })
      }
    } catch (e) {
      console.error("Error: ", e);
    }
    setLoading(false);
  }

  let viewChanges = () => {
    VSCodeMessage.postMessage({
      type: "viewChanges"
    })
  }

  let revertChanges = () => {
    VSCodeMessage.postMessage({
      type: "revertChanges"
    })
  }

  let handleKeyPress = (event: any) => {
      // console.log(event);
      if(event.key === 'Enter') {
          console.log("Sending message on enter");
          sendMessage(message);
      }
  }

  let resetMessages = async () => {
    VSCodeMessage.postMessage({
      type: "reset"
    });
    await axios.post(
      "http://localhost:54323/reset_conversation",
      {},
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    )
  }

  return (
    <Container py='lg' px='md'>
      <Tabs defaultValue="chat">
        {/* <Button onClick={() => window.location.reload()}>Reload webpage</Button> */}
        <Tabs.List>
          <Tabs.Tab value="chat">Chat</Tabs.Tab>
          <Tabs.Tab value="sources">Sources</Tabs.Tab>
          <Tabs.Tab value="server">Server</Tabs.Tab>
        </Tabs.List>
      
        <Tabs.Panel value="chat">
          <Box m="lg">
            {/* {JSON.stringify(messages)} */}
            {messages.length > 0 && <Button variant="filled" onClick={() => resetMessages()}>Reset conversation</Button>}
            {errorMessage.length > 0 && <Card shadow="sm" padding="xl" color="red">
                <Text>There was an error.</Text>
              </Card>}

            {messages.map((item, index) => (
                <Card shadow="sm" m={4}>
                  <ScrollArea>
                    {(item.content) && <EnhancedMarkdown content={(typeof item.content !== "string") ? JSON.stringify(item.content) : item.content} snippets={snippets} role={item.from + " to " + item.to}/>}
                  </ScrollArea>
                </Card>
              ))}

            
            {(!loading && messages.length > 0) && <Group>
              <Button variant="outline" size="xs" onClick={() => sendMessage("Continue")}>✅ Continue</Button>
              <Button variant="outline" size="xs" onClick={() => sendMessage("Exit")}>❌ Exit</Button>
            </Group>}
            <Text m="sm" size="xs">Press Enter to send and Shift-Enter for newline.</Text>
            <Textarea placeholder="Provide feedback" disabled={loading} value={message} onChange={(e) => setMessage(e.target.value)} onKeyPress={handleKeyPress}/>
            <Button variant="outline" size="xs" disabled={loading} onClick={() => sendMessage(message)}>➡️ Send</Button>

            {snippets.map((item, index) => (
              <>
                {item.isCurrent && 
                  <Card shadow="sm" key={index}>
                  <ScrollArea>
                    <Text>{item.filepath}</Text>
                    <SyntaxHighlighter language={item.language} style={dark}>
                      {item.code}
                    </SyntaxHighlighter>
                  </ScrollArea>
                  <Button variant="outline" onClick={() => deleteSnippet(index)}>Delete</Button>
                </Card>}
              </>
            ))}

            {messages.length >= 2 && <Group my="sm">
              {/* <Button disabled={loading} variant="default" onClick={() => saveCurrent()}>Save Current</Button> */}
              <Button disabled={loading} variant="default" onClick={() => viewChanges()}>View Changes</Button>
              <Button disabled={loading} variant="default" onClick={() => revertChanges()}>Revert Changes</Button>
            </Group>}
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

        <Tabs.Panel value="server">
          <code>{serverData}</code>
          <br/>
          <Button onClick={() => VSCodeMessage.postMessage({type: "startServer"})}>Start Server</Button>
          <Button onClick={() => VSCodeMessage.postMessage({type: "stopServer"})}>Stop Server</Button>
          <Button onClick={() => VSCodeMessage.postMessage({type: "clearServerOutput"})}>Clear</Button>
        </Tabs.Panel>

      </Tabs>

      {/* <Text>{JSON.stringify(snippets)}</Text> */}
    </Container>
  );
}

export default App;
