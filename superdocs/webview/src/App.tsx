import React, {useState, useEffect} from 'react';
import './App.css';
import { Container, Card, Textarea, Group, Button, Box, Badge, Loader, Tabs, Text, Checkbox, TextInput, ScrollArea, Accordion, Paper} from "@mantine/core"
import { VSCodeMessage } from './lib/VSCodeMessage';
import EnhancedMarkdown from './lib/EnhancedMarkdown';
import { Message } from './lib/Message';
import { Snippet } from './lib/Snippet';
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter';
import { dark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import axios, { all } from 'axios';
import ReactJson from 'react-json-view';
import { notifications } from '@mantine/notifications';
import { toast } from 'react-toastify';
import ReactDiffViewer from 'react-diff-viewer';

let serverUrl = "http://127.0.0.1:8123/"

function App() {

  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<string | null>("information");
  const [loading, setLoading] = useState(false);

  const [objective, setObjective] = useState<string>();
  const [plan, setPlan] = useState<string>("");
  const [context, setContext] = useState<string[]>([]);

  const [executionMessages, setExecutionMessages] = useState<string[]>([]);
  const [executionChanges, setExecutionChanges] = useState<any[]>([]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [hidden, setHidden] = useState<boolean[]>(Array(1000).fill(false));
  
  const [directory, setDirectory] = useState("");
  const [sources, setSources] = useState([]);

  const [infoIterate, setInfoIterate] = useState(false);

  const [tokenLimit, setTokenLimit] = useState("1500");

  useEffect(() => {
    VSCodeMessage.onMessage((message) => {
      console.log("Received message: ", message)
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
        let relativeFilepath = content.filepath.replace(directory, "")
        let snippetText = `Filepath: ${relativeFilepath} \n \`\`\`${content.language} \n ${content.code} \n \`\`\``;

        console.log("Received snippet with information: ", directory, relativeFilepath, snippetText, directory)
        setContext([...context, snippetText]);
      } else if (type == "responseRequest") {
        requestUserResponse();
      } else if (type == "info") {
        setDirectory(content["directory"]);
        sendApiKeyToBackend(content);
      }
    });
  }, []);

  let requestUserResponse = () => {
    setLoading(false);
  }

  let sendApiKeyToBackend = async (content: any) => {
    setMessage("Sending API Key information over to the backend...");
    setLoading(true);

    try {
      let response = await axios.post(`${serverUrl}/define_models`, content);
      console.log("Finished sending the information over to the backend: ", response)
      if(response.statusText !== "OK") {
        throw "Error";
      }
    } catch (e) {
      console.error(e);
      toast("There was an error sending information to the backend");
    }

    setMessage("");
    setLoading(false);
  }

  let sendExecutorMessage = async () => {
    setMessage("");
    setLoading(true);

    let integerTokenLimit = 1536;
    try {
      integerTokenLimit = parseInt(tokenLimit);
    } catch (e) {
      toast("There was an error parsing your custom token limit, defaulting to 1536")
    }

    
    try {
      let response = await axios.post(`${serverUrl}/execute`, {
        context: context,
        plan: plan,
        message: message,
        directory: directory,
        tokenLimit: integerTokenLimit
      });
      console.log("Received execution response from the backend: ", response)
      if(response.statusText !== "OK"){
        throw "Error";
      }

      let messages = [];
      let changes = [];

      for(var i = 0; i < response.data.execution.length; i++){
        if(response.data.execution[i].type == "message"){
          console.log("Message: " , response.data.execution[i].content)
          messages.push(response.data.execution[i].content);
        } else if (response.data.execution[i].type == "changes") {
          console.log("Change: ", response.data.execution[i].content);
          changes.push(response.data.execution[i].content);
        } 
      }

      setExecutionChanges(changes);
      setExecutionMessages(messages);
    } catch (e) {
      console.error(e);
      toast("There was an error");
    }

    setLoading(false);
  }

  let sendChatMessage = async (autoretrieveContext: boolean) => {
    setMessage("");
    setLoading(true);

    try {
      let response = await axios.post(`${serverUrl}/chat`, {
        messages: messages,
        context: context,
        autoretrieveContext: autoretrieveContext
      });
      if (!response.data){
        throw "Error";
      }
      setContext([...context, ...response.data.context]);
      setMessages([...messages, response.data.answer]);
    } catch (e) {
      console.error(e);
      toast("There was an error");
    }

    setLoading(false);
  }

  let sendInformationRetrievalMessage = async (query: string) => {
    setMessage("");
    setLoading(true);

    try {
      let response = await axios.post(`${serverUrl}/information`, {
        objective: query,
        context: context,
        directory: directory
      });
      if(!response.data){
        throw "Error";
      }
      setContext(response.data.context)
    } catch (e) {
      console.error(e);
      toast("There was an error");
    }

    setLoading(false);
  }

  let sendPlanCreationRequest = async () => {
    setLoading(true);

    try {
      let response = await axios.post(`${serverUrl}/plan`, {
        objective: objective,
        directory: directory,
        context: context
      });
      if(!response.data){
        throw "Error loading!";
      }
  
      setPlan(response.data.plan)
    } catch (e) {
      console.error(e);
      toast("There was an error");
    }


    setLoading(false);
  }

  let makeElementHidden = (index: number) => {
    let tempHidden = [...hidden];
    tempHidden[index] = !tempHidden[index];
    setHidden(tempHidden);
  }

  let contextWithoutIndex = (arr: string[], index: number) => {
    if (index < 0 || index >= arr.length) {
      return arr;
    }
    return arr.filter((_, i) => i !== index);
  }

  let deleteContextElement = (index: number) => {
    const newContext = contextWithoutIndex(context, index);
    setContext(newContext);
  }

  let getSources = async () => {}

  let resetMessages = async () => {
    setMessages([]);
    setHidden(Array(1000).fill(false));
  }

  let loadVectorstore = async () => {
    setLoading(true);
    try {
      await axios.post(`${serverUrl}/load_vectorstore`, {
        "directory": directory
      },  {
        headers: {
          'Content-Type': "application/json;charset=UTF-8"
        }
      });
    } catch (e) {
      console.error(e);
      toast("There was an error");
    }
    setLoading(false);
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
           
            <Text>Currently in directory:</Text>
            <TextInput onChange={(e) => setDirectory(e.target.value)} value={directory} m={2} placeholder="Your directory should automatically load here. Edit it to be in the correct git directory."></TextInput>

            <Textarea placeholder="State your objective" onChange={(e) => setObjective(e.target.value)} value={objective}/>

            {messages.length > 0 && <Button variant="filled" onClick={() => resetMessages()}>Reset conversation</Button>}
            <Button variant="outline" onClick={() => loadVectorstore()}>Load vectorstore</Button>
            {loading && <Loader/>}

            <Accordion defaultValue="information" value={mode} onChange={setMode}>
              <Accordion.Item key="information" value="information">
                <Accordion.Control>🔎 information</Accordion.Control>
                <Accordion.Panel>
                  <Button onClick={() => setContext([])}>Clear Context</Button>
                  <Button onClick={() => sendInformationRetrievalMessage(objective ? objective : "")}>Retrieve Context from Objective</Button>

                  {context?.map((item, index) => (
                    <Paper mt="lg"
                      shadow="sm"
                      p="sm"
                      radius="sm">
                      <Box>
                        <Badge onClick={() => makeElementHidden(index)} color={hidden[index] ? "gray" : "blue"}>{hidden[index] ? "Unhide" : "Hide"} Source</Badge>
                        <Badge onClick={() => deleteContextElement(index)}>Delete Source</Badge>
                      </Box>
                      <EnhancedMarkdown message={{role: "context", content: item}}/>
                    </Paper>
                  ))}

                </Accordion.Panel>
              </Accordion.Item>
              <Accordion.Item key="plan" value="plan">
                <Accordion.Control>📋 plan</Accordion.Control>
                <Accordion.Panel>
                  <Textarea placeholder="The plan will be here and you can edit it" value={plan} onChange={(e) => setPlan(e.target.value)} rows={10}/>
              

                  <Button onClick={() => sendPlanCreationRequest()}>Create Plan from context and objective</Button>
                </Accordion.Panel>
              </Accordion.Item>
              <Accordion.Item key="execution" value="execution">
                <Accordion.Control>📝 execution</Accordion.Control>
                <Accordion.Panel>

                <Text>Set execution custom token limit (currently disabled):</Text>
                <TextInput disabled={true} onChange={(e) => setTokenLimit(e.target.value)} value={tokenLimit}></TextInput>


                  {executionChanges.length}
                  {executionChanges.map((item, index) => (
                    <Box key={index}>
                      {/* <Text>{JSON.stringify(item)}</Text> */}
                      <Badge size="xl" variant="gradient">{item.old.length > 0 ? "Replacement" : "Write"}</Badge>
                      <Text style={{fontWeight: 'bold'}}>Filepath: {item.filepath}</Text>
                      <ReactDiffViewer oldValue={item.old} newValue={item.new}></ReactDiffViewer>
                      {item.old.length > 0 && <Button onClick={() => VSCodeMessage.postMessage({type: "replaceSnippet", content: {originalCode: item.old, newCode: item.new, filepath: item.filepath}})}>Make Replacement</Button>}
                      {item.old.length == 0 && <Button onClick={() => VSCodeMessage.postMessage({type: "writeFile", content: {newCode: item.new, filepath: item.filepath}})}>Write to File</Button>}
                    </Box>
                  ))}
                  {executionMessages.map((item, index) => (
                    <Box key={index}>
                      <EnhancedMarkdown message={{role: "executor", content: item}}/>
                    </Box>
                  ))}
                  <Button onClick={() => sendExecutorMessage()}>Create execution based on plan</Button>
                </Accordion.Panel>
              </Accordion.Item>
              <Accordion.Item key="chat" value="chat">
                <Accordion.Control>💬 chat</Accordion.Control>
                <Accordion.Panel>
                  {messages.map((item, index) => (
                    <EnhancedMarkdown message={item}/>
                  ))}
                  <Button onClick={() => sendChatMessage(true)}>Send message + retrieve context</Button>
                  <Button onClick={() => sendChatMessage(false)}>Send message with existing context</Button>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>

          </Box>
        </Tabs.Panel>
      </Tabs>

      {/* <Text>{JSON.stringify(snippets)}</Text> */}
    </Container>
  );
}

export default App;

