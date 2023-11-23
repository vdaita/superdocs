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
  
  const [sources, setSources] = useState<any[]>([]);

  const [allSnippets, setAllSnippets] = useState<Snippet[]>([]);

  useEffect(() => {
    VSCodeMessage.onMessage((message) => {
      // console.log("Received message: ", message)
      let content = message.data.content;
      let type = message.data.type;
      console.log(content, type);
      if(type == "messages"){
        console.log("Messages: ", content);
        // for(var i = 0; i < content.length; i++){
        //   if(!(typeof content[i].content === "string")){
        //     content[i].content = undefined;
        //     content[i].content_object = content[i].content
        //   }
        // }
        setMessages(content);
        if(content.length > 0){
          setLoading(true);
        } else {
          setLoading(false);
        }
      } else if (type == "snippet") {
        // console.log("Current snippets: ", snippets, " new contents: ", content);
        setSnippets((existingArray) => [...existingArray, content]);
        setAllSnippets((existingArray) => [...existingArray, content]);
      } else if (type == "responseRequest") {
        requestUserResponse();
      }
    });
  }, []);

  let requestUserResponse = () => {
    setLoading(false);
  }

  // let getAllSnippetsForMessages = (messages: Message[]) => {
  //   let extractedSnippets: string[] = [];
  //   for(var i = 0; i < messages.length; i++){
  //     if(messages[i].from === "human"){
  //       let messageSnippets = getSnippets(messages[i].content!);
  //       console.log("For a message: ", messageSnippets);
  //       extractedSnippets = [...extractedSnippets, ...messageSnippets];
  //     }
  //   }
  //   console.log("Got snippet: ", extractedSnippets);
  //   return extractedSnippets;
  // }

  let getSnippets = (markdownContent: string) => {
    const codePattern = /```([a-zA-Z]+)\s*([\s\S]+?)```/g;
    const codeSnippets = [];
    let match;

    while ((match = codePattern.exec(markdownContent)) !== null) {
      const [, language, code] = match;
      const cleanedCode = code.replace(new RegExp(`^\\s*${language}\\s*`, 'i'), '').trim();
      codeSnippets.push(cleanedCode);
    }

    return codeSnippets;
  }

  let sendMessage = async (message: string) => {
    let fullMessage = message;
    if(snippets.length > 0){
      fullMessage += "\n ### Code snippets: \n"
      for(var i = 0; i < snippets.length; i++){
        fullMessage += "```" + snippets[i].language + "\n" + snippets[i].code + "\n```\n";
      }
    }

    if(messages.length === 0){
      await axios.post('http://127.0.0.1:54323/initiate_chat', {
        "message": fullMessage
      }, {
        headers: {
          'Content-Type': "application/json;charset=UTF-8"
        }
      });
      setMessage("");
      setSnippets([]);
      setLoading(true);
      return;
    }
    VSCodeMessage.postMessage({
      type: "response",
      content: fullMessage
    });
    setMessage("");
    setSnippets([]);
    setLoading(true);
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

  let getSources = async () => {
    setLoading(true);
    let sources = await axios({
      method: "get",
      url: "http://127.0.0.1:54323/get_sources"
    });

    console.log(sources.data);

    let data = sources.data;
    let reformatted = []
    for(var i = 0; i < data.documents.length; i++){
      reformatted.push({
        document: data.documents[i],
        id: data.ids[i],
        metadata: data.metadatas[i]
      });
    }
    console.log("Reformatted: ", reformatted);
    setSources(reformatted);

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
    } catch (e) {
      console.error("Error: ", e);
    }
    setLoading(false);
  }

  let addSource = () => {

  }

  let deleteSources = () => {

  }

  // let saveCurrent = () => {

  // }

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
        <Tabs.List>
          <Tabs.Tab value="chat">Chat</Tabs.Tab>
          <Tabs.Tab value="sources">Sources</Tabs.Tab>
        </Tabs.List>
      
        <Tabs.Panel value="chat">
          <Box m="lg">
            {/* {JSON.stringify(messages)} */}
            {messages.length > 0 && <Button variant="filled" onClick={() => resetMessages()}>Reset conversation</Button>}

            {messages.map((item, index) => (
                <Card shadow="sm" m={4}>
                  <ScrollArea>
                    {(item.content) && <EnhancedMarkdown content={(typeof item.content !== "string") ? JSON.stringify(item.content) : item.content} snippets={allSnippets} role={item.from + " to " + item.to}/>}
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
              <Card shadow="sm" key={index}>
                <ScrollArea>
                  <SyntaxHighlighter language={item.language} style={dark}>
                    {item.code}
                  </SyntaxHighlighter>
                </ScrollArea>
                <Button variant="outline" onClick={() => deleteSnippet(index)}>Delete</Button>
              </Card>
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

      </Tabs>

      {/* <Text>{JSON.stringify(snippets)}</Text> */}
    </Container>
  );
}

export default App;
