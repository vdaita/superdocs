import React, {useState, useEffect} from 'react';
import './App.css';
import { Container, Card, Textarea, Group, Button, Box, Loader, Tabs, Text } from "@mantine/core"
import { VSCodeMessage } from './lib/VSCodeMessage';
import EnhancedMarkdown from './lib/EnhancedMarkdown';
import { Message } from './lib/Message';
import { Snippet } from './lib/Snippet';
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter';
import axios, { all } from 'axios';

function App() {

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  
  const [allSnippets, setAllSnippets] = useState<Snippet[]>([]);

  useEffect(() => {
    VSCodeMessage.onMessage((message) => {
      // console.log("Received message: ", message)
      let content = message.data.content;
      let type = message.data.type;
      console.log(content, type);
      if(type == "messages"){
        // console.log("Messages: ", content.messages, content.done);
        setMessages(content.messages);
        // setAllSnippets(getAllSnippetsForMessages(content.messages));
        if(content.done){
          setLoading(false)
        }
      } else if (type == "snippet") {
        // console.log("Current snippets: ", snippets, " new contents: ", content);
        setSnippets((existingArray) => [...existingArray, content]);
        setAllSnippets((existingArray) => [...existingArray, content]);
      }
    });
  }, []);

  let getAllSnippetsForMessages = (messages: Message[]) => {
    let extractedSnippets: string[] = [];
    for(var i = 0; i < messages.length; i++){
      if(messages[i].role === "human"){
        let messageSnippets = getSnippets(messages[i].content);
        console.log("For a message: ", messageSnippets);
        extractedSnippets = [...extractedSnippets, ...messageSnippets];
      }
    }
    console.log("Got snippet: ", extractedSnippets);
    return extractedSnippets;
  }

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

  let sendMessage = () => {
    let fullMessage = message;
    if(snippets.length > 0){
      fullMessage += "\n ### Code snippets: \n"
      for(var i = 0; i < snippets.length; i++){
        fullMessage += "```" + snippets[i].language + "\n" + snippets[i].code + "\n```\n";
      }
    }
    axios({
      method: "post",
      url: "http://127.0.0.1:54323/send_message",
      data: {
        message: fullMessage
      },
      headers: {
        "Content-Type": "application/json",
        // "Access-Control-Allow-Origin": "no-cors"
      }
    }).then(() => {

    }).catch((e) => {
      console.error(e);
      setLoading(false);
      setMessages([...messages, {role: "assistant", content: "There was an error"}]);
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

  let getSources = () => {

  }

  let addSource = () => {

  }

  let deleteSources = () => {

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

            {messages.map((item, index) => (
                <Card shadow="sm" m={4}>
                  <EnhancedMarkdown content={item.content} snippets={allSnippets} role={item.role}/>
                </Card>
              ))}

            <Textarea disabled={loading} value={message} onChange={(e) => setMessage(e.target.value)}/>
            {snippets.map((item, index) => (
              <Card shadow="sm" key={index}>
                <SyntaxHighlighter language={item.language}>
                  {item.code}
                </SyntaxHighlighter>
                <Button variant="outline" onClick={() => deleteSnippet(index)}>Delete</Button>
              </Card>
            ))}

            <Group my="sm">
              <Button disabled={loading} variant="default" onClick={() => sendMessage()}>Send to Agent</Button>
            </Group>
          </Box>
        </Tabs.Panel>

        <Tabs.Panel value="sources">

        </Tabs.Panel>

      </Tabs>

      {/* <Text>{JSON.stringify(snippets)}</Text> */}
    </Container>
  );
}

export default App;
