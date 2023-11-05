import React, { useState, useEffect } from 'react';
import './App.css';
import { Container, Card, Textarea, Group, Button, Box, Loader, Tabs } from "@mantine/core";
import { VSCodeMessage } from './lib/VSCodeMessage';
import EnhancedMarkdown from './lib/EnhancedMarkdown';
import { Message } from './lib/Message';
import axios from 'axios';

function App() {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [snippets, setSnippets] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [newSource, setNewSource] = useState("");

  useEffect(() => {
    VSCodeMessage.onMessage((message) => {
      switch (message.type) {
        case 'messages':
          setMessages(message.content);
          break;
        case 'snippet':
          setSnippets([...snippets, message.content]);
          break;
        case 'doneLoading':
          setLoading(false);
          break;
        default:
          break;
      }
    });
  }, [snippets]);

  let sendMessage = () => {
    VSCodeMessage.postMessage({
      type: "message",
      content: message,
    });

    setMessage("");
    setSnippets([]);
    setLoading(true);
  };

  let deleteSnippet = (index: number) => {
    let tempSnippets = [...snippets];
    tempSnippets.splice(index, 1);
    setSnippets(tempSnippets);
  };

  let addSource = async (url: string) => {
    setSources((prevSources: string[]) => [...prevSources, url]);

    try {
      // Send a POST request to the appropriate backend API route for adding the source
      await axios.post("/add_source", { url });
    } catch (error) {
      console.error("Failed to add the source:", error);
    }
  };

  let deleteSources = async (index: number) => {
    const updatedSources = [...sources];
    updatedSources.splice(index, 1);
    setSources(updatedSources);

    // You can add the logic to delete the source from the backend here.
  };

  return (
    <Container py="lg" px="md">
      <Tabs defaultValue="chat">
        <Tabs.List>
          <Tabs.Tab value="chat">Chat</Tabs.Tab>
          <Tabs.Tab value="sources">Sources</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="chat">
          <Box m="lg">
            {messages.map((item, index) => (
              <Card shadow="sm" key={index}>
                <p>
                  <b>{item.role}</b>
                </p>
                <EnhancedMarkdown content={item.content} />
              </Card>
            ))}

            <Textarea
              disabled={loading}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            {snippets.map((item, index) => (
              <Card shadow="sm" key={index}>
                <EnhancedMarkdown content={item} />
                <Button
                  variant="outline"
                  onClick={() => deleteSnippet(index)}
                >
                  Delete
                </Button>
              </Card>
            ))}

            <Group my="sm">
              <Button
                disabled={loading}
                variant="default"
                onClick={() => sendMessage()}
              >
                Send to Agent
              </Button>
            </Group>
          </Box>
        </Tabs.Panel>

        <Tabs.Panel value="sources">
          <Box m="lg">
            <div>
              <h3>Add Source</h3>
              <input
                type="text"
                placeholder="Enter URL"
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
              />
              <button onClick={() => addSource(newSource)}>Add</button>
            </div>

            <div>
              <h3>Current Sources</h3>
              <ul>
                {sources.map((source, index) => (
                  <li key={index}>
                    {source}
                    <button onClick={() => deleteSources(index)}>Delete</button>
                  </li>
                ))}
              </ul>
            </div>
          </Box>
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}

export default App;