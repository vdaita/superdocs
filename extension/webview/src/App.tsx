import React, { useState, useEffect, useRef } from 'react';
import { Container, Button, Text, TextInput, Textarea, Stack, Tabs, Card, Badge, Loader, Box, Checkbox, Overlay } from '@mantine/core';
import EnhancedMarkdown from './lib/EnhancedMarkdown';
import { User, createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { notifications } from '@mantine/notifications';
import { VSCodeMessage } from './lib/VSCodeMessage';
import { usePostHog } from 'posthog-js/react'
import { CopyBlock } from 'react-code-blocks';

const SUPABASE_URL = "https://qqlfwjdpxnpoopgibsbm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxbGZ3amRweG5wb29wZ2lic2JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDE0MDM0MjYsImV4cCI6MjAxNjk3OTQyNn0.FfCGI17DLv3Ejsno5--5XyfzCQtCLnoyeTf2cxGgOvc";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

type Generation = {
  planCompleted: boolean;
  changesCompleted: boolean;
  changes: {
    filepath: string;
    instruction: string;
    location: string;
    search_block: string;
    replace_block: string;
  }[];
  rank: number;
  progress: string;
  plan: string;
  summary: string;
};

type Plan = {
  message: string
  changes: Change[] 
}

type EditInstruction = {
  instruction: string
  filepath: string
  changesCompleted: boolean
  changeUpdate?: string
  changes?: Change[]
}

type Change = {
  filepath: string
  searchBlock: string
  replaceBlock: string
}

type NewFile = {
  filepath: string,
  code: string,
}

type Snippet = {
  filepath: string
  code: string
  language: string
}

export default function App(){
  let [query, setQuery] = useState("");
  let [snippets, setSnippets] = useState<Snippet[]>([]);
  
  let [plans, setPlans] = useState<Plan[]>([]);

  let [error, setError] = useState<string | undefined>();

  let [user, setUser] = useState<User>();
  let [email, setEmail] = useState<string>("");
  let [sentCode, setSentCode] = useState<boolean>(false);
  let [otpCode, setOtpCode] = useState<string>("");

  let [addEverythingFromWorkspace, setAddEverythingFromWorkspace] = useState(false);

  let [predictCurrentObjective, setPredictCurrentObjective] = useState(false);
  let predictCurrentObjectiveRef = useRef<boolean>(false);
  predictCurrentObjectiveRef.current = predictCurrentObjective;
  let lastPredictionRequestSent = useRef<number>(0);

  let posthogIdentifiedUserRef = useRef<boolean>(false);

  let [candidateQueries, setCandidateQueries] = useState([]);

  let [loading, setLoading] = useState<boolean>(false);
  let [abortController, setAbortController] = useState<AbortController | undefined>();
  const posthog = usePostHog();

  useEffect(() => {
    console.log("Running useEffect");
    VSCodeMessage.onMessage((message) => {
      message = message.data;
      console.log("Received message: ", message);
      if(message.type === "context") {
        if(message.content.telemetryAllowed) {
          posthog.opt_in_capturing();
        } else {
          posthog.opt_out_capturing();
        }
      } else if (message.type === "snippet") {
        console.log("Received snippet: ", message)
        setSnippets((prevSnippets) => {
          console.log("Considering adding a new snippet to this list of snippets: ", prevSnippets);
          let alreadyExists = false;
          for(var i = 0; i < prevSnippets.length; i++){
            // console.log("Comparing: ", {
            //   currFilepath: prevSnippets[i].filepath,
            //   currCode: prevSnippets[i].code,
            //   newFilepath: message.content.filepath,
            //   newCode: message.content.code,
            //   returning: prevSnippets[i].filepath === message.content.filepath && prevSnippets[i].code === message.content.code
            // });
            if(prevSnippets[i].filepath === message.content.filepath && prevSnippets[i].code === message.content.code){
              alreadyExists = true;
              break;
            }
          }
          
          if(alreadyExists){
            return [...prevSnippets];
          } else {
            return [...prevSnippets, {
              code: message.content.code,
              filepath: message.content.filepath,
              language: message.content.language
            }]
          }
        });
      } else if (message.type == "processRequest") {
        processRequestWithSnippets(message.content.snippets, message.content.query);
      } else if (message.type == "recentChanges") {
        console.log("Will send predict current objective request? : ", predictCurrentObjectiveRef.current, " last prediction sent: ", lastPredictionRequestSent.current, " current time: ", Date.now());
        if(predictCurrentObjectiveRef.current && (Date.now() - 5000) > lastPredictionRequestSent.current){
          lastPredictionRequestSent.current = Date.now();
          processRecentChangesRequest(message.content["changes"], message.content["workspaceFiles"]);
        }
      }

      supabase.auth.onAuthStateChange((event, session) => {
        setUser(session!.user);
      });
    });
    VSCodeMessage.postMessage({
      type: "startedWebview"
    });
    // TODO: listen for a change in the authentication state
  }, []);

  useEffect(() => {
    if(!posthogIdentifiedUserRef.current){
      if (user) {
        console.log("PostHog identified user.")
        posthog?.identify(
          user.id, {
            email: user.email
          }
        );
        posthogIdentifiedUserRef.current = true;
      }
    } else {
      console.log("Skipping posthog identification")
    }
  }, [posthog, user]);


  // TOOD: make sure that you allow the person to reclick for anonymous authentication again.
  let processRequest = async () => {
    await processRequestWithSnippets(snippets, query);
  }

  let stopRequest = async () => {
    if(abortController){
      abortController.abort();
      notifications.show({
        message: "Cancelled the request."
      });
    } else {
      notifications.show({
        message: "No request to cancel"
      })
    }
  }

  let processRecentChangesRequest = async (changes: string, workspaceFiles: string) => {
    let url = (process.env.NODE_ENV === "development") ? "http://localhost:3001/api/recommend_prompts" : "https://superdocs-sand.vercel.app/api/recommend_prompts/";
    console.log("Running processRecentChangesRequest function");
    try {
      if (changes.length < 10) {
        console.log("Skipping - less that 30 characters detected.");
        return;
      }
      
      console.log("Sending recent changes: ", changes);
      let response = await fetch(url, {
        body: JSON.stringify({
          changes: changes,
          workspaceFiles: workspaceFiles
        }),
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        }
      });
      if(response.ok) {
        console.log("processRecentChangesRequest: got OK response from server");
        let json = await response.json();
        console.log("Recent changes request json: ", json);
        setCandidateQueries(json['possibleQueries']);
      } else {
        console.error("Error with recent changes request: ", response);
      }
    } catch (e) {
      console.log("Error when processing recent changes request");
      console.error(e);
    }
  }

  let processRequestWithSnippets = async (snippets: Snippet[], query: string) => {
    posthog?.capture("process_snippets");
    setError("");

    console.log("Current environment: ", process.env.NODE_ENV);
    let url = (process.env.NODE_ENV === "development") ? "http://localhost:3001/api/index" : "https://superdocs-sand.vercel.app/api/index/";

    let authSession = await supabase.auth.getSession();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
    }, 5000);

    try {
      console.log("Sending session: ", authSession.data.session);
      console.log("Sending snippets and query: ", snippets, query);

      const controller = new AbortController();
      const signal = controller.signal;
      setAbortController(controller);

      let response = await fetch(url, {
        body: JSON.stringify({
          snippets: snippets,
          request: query,
          session: authSession.data.session
        }),
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        signal: signal
      });
      console.log("Received response from server: ", response);
      if(response.ok){
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
  
        let done = false;
        while(!done){
          const { value, done: doneReading } = await reader.read();
          done = doneReading;
          let chunkValue = decoder.decode(value);
          console.log("Chunk value from backend: ", chunkValue);
          if(chunkValue.length == 0){
            console.log("Blank chunk - skipping.");
            continue;
          }
          let splitChunks = chunkValue.split("<SDSEP>");
          
          try {
            splitChunks.forEach((chunk) => {
              if(chunk.length == 0){
                return;
              }
              let parsedChunk = JSON.parse(chunk);
              console.log("Received chunk of type: ", parsedChunk["type"]);
              if(parsedChunk["type"] === "plan") {
                setPlans([parsedChunk["plan"]]);
              }
            });
          } catch (e) {
            console.error("Processing error: moving on - ", e, splitChunks);
          }
        }
      } else {
        console.error("Response error: ", response);
        setError("There was an error on the server.");
      }
    } catch (e) {
      console.error("Error: ", e);
      setError("There was an error.");
    }
    console.log("Reached the end of the function.");
    setLoading(false);
  }

  let getMatchingLanguageFromFilepath = (filepath: string) => {
    snippets.forEach((snippet) => {
      if(snippet.filepath == filepath) {
        return snippet.language;
      }
    });
    return "text";
  }

  let addSnippetsFromVectors = (query: string) => { // TODO: start this when you have the vectorstore implemented
    VSCodeMessage.postMessage(() => { // ask for a response to be sent back

    });
  }

  let addWorkspaceAndProcessRequest = () => {
    VSCodeMessage.postMessage({
      type: "getWorkspaceData",
      content: {
        runProcessRequest: true,
        query: query
      }
    });
  }

  let deleteSnippet = (index: number) => {
    console.log("Trying to delete snippet at index: ", index);
    setSnippets((prevSnippets: Snippet[]) => {
      let newList = prevSnippets.splice(index, 1);
      console.log("Delete snippet - spliced list: ", newList);
      return newList;
    });
  }

  let sendCode = async () => {
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithOtp({
      email: email,
      options: {
        shouldCreateUser: false
      }
    });

    if(error){
      console.error("sendCode: ", error);
      notifications.show({
        message: error.message,
        title: "There was an error sending your code."
      })
    } else {
      setSentCode(true);
    }

    setLoading(false);
  }

  let verifyCode = async () => {
    setLoading(true);

    const {
      data: { session },
      error
    } = await supabase.auth.verifyOtp({
      email: email,
      token: otpCode,
      type: "email"
    });

    if(session){
      setUser(session?.user);
    }

    if(error){
      console.error("verifyCode", error);
      notifications.show({
        message: error.message,
        title: "There was an error verifying your code."
      });
    }

    setLoading(false);
  }

  let sendChange = (filepath: string, search_block: string, replace_block: string) => {
    posthog?.capture("send_change");

    VSCodeMessage.postMessage({
      type: "replaceSnippet",
      content: {
        originalCode: search_block,
        newCode: replace_block,
        filepath: filepath
      }
    })
  }

  let writeFile = (filepath: string, content: string) => {
    VSCodeMessage.postMessage({
      type: "writeFile",
      content: {
        filepath: filepath,
        code: content
      }
    })
  }

  if(!user) {
    if(sentCode){
      return (
        <Container m="sm">
          <TextInput value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="OTP Code"></TextInput>
          <Button disabled={loading} onClick={() => verifyCode()}>Confirm code</Button>
          {loading && <Loader/>}
          <br/>
          <Button onClick={() => setSentCode(false)} variant={'outline'}>Go back</Button>
        </Container>
      )
    } else {
      return (
        <Container m="sm">
          <TextInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"></TextInput>
          <Button disabled={loading} onClick={() => sendCode()}>Send Code</Button>
          <br/>
          <p style={{fontSize: 12}}>60 second wait time required between emails.</p>
          {loading && <Loader/>}
        </Container>
      )
    }
  }

  let setPredictAndAllWorkspace = (newValue: boolean, checkbox: string) => { // If predict is true, then add all open tabs is true. If add all open tabs is false, then predict is true
      if(checkbox === 'predict' && newValue){
        setAddEverythingFromWorkspace(true);
        setPredictCurrentObjective(true);
        return;
      }

      if(checkbox == 'addAll' && !newValue){
        setAddEverythingFromWorkspace(false);
        setPredictCurrentObjective(false);
        return;
      }

      if(checkbox == 'addAll'){
        setAddEverythingFromWorkspace(newValue);
      }

      if(checkbox == 'predict') {
        setPredictCurrentObjective(newValue);
      }
  }

  return (
    <Stack p={2} mt={6}>
      <Textarea onChange={(e) => setQuery(e.target.value)} size="lg" value={query} placeholder={"Query"}>
      </Textarea>

      {candidateQueries.map((item, index) => (
        <Card shadow="sm" padding="xs" radius="md" withBorder onClick={() => setQuery(item)}>
          <Text size="sm">{item}</Text>
        </Card>
      ))}

      {loading && <Box>
        <Text style={{fontSize: 10}}>Need to refresh? Refresh the Webview by using Ctrl-Shift-P → Reload Webviews. Will be fixed.</Text>
        <Loader/>
      </Box>}
      
      {(!addEverythingFromWorkspace && snippets.length > 0) && <Button variant='outline' onClick={() => setSnippets([])}>Clear Snippets</Button> }
      {!addEverythingFromWorkspace && <Container m="sm" opacity="80">
        {snippets.map((item, index) => (
          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <details>
              <summary>{item.filepath}</summary>
              <EnhancedMarkdown height={100} message={`${item.filepath}\n\n` + "```" + `${item.language}\n${item.code}` + "\n```"}/>
            </details>
            <Button onClick={() => deleteSnippet(index)}>
              Delete Snippet
            </Button>
          </Card>
        ))}
        {/* <Overlay opacity={0.6}/> */}
      </Container>}

      {addEverythingFromWorkspace && <Text style={{fontSize: 10}}>Can't add snippets and everything from tabs at the same time.</Text>}

      <Checkbox label="Check your changes to predict your current objective" checked={predictCurrentObjective} onChange={(e) => setPredictAndAllWorkspace(e.currentTarget.checked, 'predict')}></Checkbox>
      <Checkbox label="Add all open tabs" checked={addEverythingFromWorkspace} onChange={(e) => setPredictAndAllWorkspace(e.currentTarget.checked, 'addAll')}></Checkbox>
      <Button onClick={() => addEverythingFromWorkspace ? addWorkspaceAndProcessRequest() : processRequest()}>Process request</Button>
      {/* <Button onClick={() => stopRequest()} variant="outline">Stop Request if available</Button> */}

      {error && <Box color="red">
        {error}
      </Box>}

      <Tabs value={"0"}>
        <Tabs.List>
          {plans.map((item, index) => (
            <Tabs.Tab value={index.toString()}>
              Plan {index}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {plans.map((item, index) => (
          <Box>
            {/* {JSON.stringify(item)} */}
            {item['message'] && <EnhancedMarkdown message={item['message']} height={60}/>}
            {item["changes"] && <>
            {
              item["changes"].map((editItem, editIndex) => (
                <Card>
                  <Text style={{fontWeight: "bold"}}>{editItem.filepath}</Text>
                  <Box m="sm" bg="red">
                    Replace:
                    <CopyBlock
                      text={editItem.searchBlock}
                      language={getMatchingLanguageFromFilepath(editItem.filepath)}
                      wrapLongLines
                    />
                  </Box>
                  <Box m="sm" bg="green">
                    with: 
                    <CopyBlock
                      text={editItem.replaceBlock}
                      language={getMatchingLanguageFromFilepath(editItem.filepath)}
                      wrapLongLines
                    />
                  </Box>
  
                  <Button onClick={() => sendChange(editItem.filepath, editItem.searchBlock, editItem.replaceBlock)}>Accept change</Button>
                </Card>
              ))
            }
            </>}
          </Box>
        ))}
      </Tabs>
    </Stack>
  );
}