import React, {useState, useEffect} from 'react';
import './App.css';
import { Container, Card, Textarea, Group, Button, Box, Loader, Tabs } from "@mantine/core"
import { VSCodeMessage } from './lib/VSCodeMessage';
import EnhancedMarkdown from './lib/EnhancedMarkdown';
import { Message } from './lib/Message';

function App() {

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [snippets, setSnippets] = useState<string[]>([]);

  useEffect(() => {
    VSCodeMessage.onMessage((message) => {
      switch(message.type){
        case 'messages':
          setMessages(message.content);
          break;
        case 'snippet':
          setSnippets([...snippets, message.content]);
          break;
        case 'doneLoading':
          setLoading(false);
      }
    });
  }, []);

  let sendMessage = () => {
    VSCodeMessage.postMessage({
      type: "message",
      content: message
    });

    setMessage("");
    setSnippets([]);
    setLoading(true);
  }
  
  let deleteSnippet = (index: number) => {
    let tempSnippets = [...snippets];
    tempSnippets.splice(index, 1);
    setSnippets(tempSnippets);
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
            {messages.map((item, index) => (
                <Card shadow="sm">
                  <p><b>{item.role}</b></p>
                  <EnhancedMarkdown content={item.content}/>
                </Card>
              ))}

            <Textarea disabled={loading} value={message} onChange={(e) => setMessage(e.target.value)}/>
            {snippets.map((item, index) => (
              <Card shadow="sm">
                <EnhancedMarkdown content={item}/>
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
    </Container>
  );
}

export default App;
