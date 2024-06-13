import React, { useState, useEffect } from 'react';
import { Container, Button, Text, TextInput, Textarea, Tabs, Card, Badge, Loader, Box } from '@mantine/core';
import EnhancedMarkdown from './lib/EnhancedMarkdown';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { notifications } from '@mantine/notifications';
import { VSCodeMessage } from './lib/VSCodeMessage';
import { usePostHog } from 'posthog-js/react'
import { CodeBlock } from 'react-code-blocks';
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter'
import {dark} from 'react-syntax-highlighter/dist/esm/styles/prism'

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
  editInstructions: EditInstruction[]
  newFiles: NewFile[]
}

type EditInstruction = {
  instruction: string
  filepath: string
  changesCompleted: boolean
  changes?: Change[]
}

type Change = {
  filepath: string
  search_block: string
  replace_block: string
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

  let [user, setUser] = useState<any>(false);
  let [email, setEmail] = useState<string>("");
  let [sentCode, setSentCode] = useState<boolean>(false);
  let [otpCode, setOtpCode] = useState<string>("");

  let [loading, setLoading] = useState<boolean>(false);
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
            return prevSnippets;
          } else {
            return [...prevSnippets, {
              code: message.content.code,
              filepath: message.content.filepath,
              language: message.content.language
            }]
          }
        });
      }
    });
    VSCodeMessage.postMessage({
      type: "startedWebview"
    });
    // TODO: listen for a change in the authentication state
  }, []);


  // TOOD: make sure that you allow the person to reclick for anonymous authentication again.

  let processRequest = async () => {
    console.log("Current environment: ", process.env.NODE_ENV);
    let url = (process.env.NODE_ENV === "development") ? "http://localhost:8000/get_completion" : "";

    let authSession = await supabase.auth.getSession();

    let response = await fetch(url, {
      body: JSON.stringify({
        snippets: snippets,
        request: query,
        session: authSession.data.session
      }),
      method: "POST",
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
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
        
        let content = JSON.parse(chunkValue);
        setPlans(content);
      }
    } else {
      setError("There was an error on the server.");
    }
  }

  let deleteSnippet = (index: number) => {
    setSnippets((prevSnippets: Snippet[]) => {
      let newList = prevSnippets.splice(index, 1);
      console.log("Spliced list: ", newList);
      return newList;
    });
  }

  let sendCode = async () => {
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithOtp({
      email: email,
      options: {
        shouldCreateUser: true
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

  // if(!user) {
  //   if(sentCode){
  //     return (
  //       <Container m="sm">
  //         <TextInput value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="OTP Code"></TextInput>
  //         <Button disabled={loading} onClick={() => verifyCode()}>Confirm code</Button>
  //         {loading && <Loader/>}
  //       </Container>
  //     )
  //   } else {
  //     return (
  //       <Container m="sm">
  //         <TextInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"></TextInput>
  //         <Button disabled={loading} onClick={() => sendCode()}>Send Code</Button>
  //         {loading && <Loader/>}
  //       </Container>
  //     )
  //   }
  // }

  return (
    <Container>
      <Textarea onChange={(e) => setQuery(e.target.value)} value={query}>
      </Textarea>
      <Container m="sm">
        {snippets.map((item, index) => (
          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <EnhancedMarkdown message={{
              role: "snippet",
              content: `${item.filepath}\n\n` + "```" + `${item.language}\n${item.code}` + "\n```"
            }}/>
            <Button onClick={() => deleteSnippet(index)}>
              Delete Snippet
            </Button>
          </Card>
        ))}
      </Container>
      <Button onClick={() => processRequest()}>Process request</Button>
      {error && <Box color="red">
        {error}
      </Box>}
    
      <Tabs>
        <Tabs.List>
          {plans.map((item, index) => (
            <Tabs.Tab value={index.toString()}>
              Plan {index}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {plans.map((item, index) => (
          <Tabs.Panel value={index.toString()}>
            <Badge>Message</Badge>
            <EnhancedMarkdown message={item.message}></EnhancedMarkdown>
            {item.editInstructions.length > 0 && <Box>
              <Badge>Edits</Badge>
              {item.editInstructions.map((instructionItem, instructionIndex) => (
                <Box>
                  {instructionItem.instruction}
                  {instructionItem.changesCompleted && <Box>
                      {instructionItem.changes?.map((changeItem, changeIndex) => (
                        <Card>
                          <Text style={{fontWeight: "bold"}}>{changeItem.filepath}</Text>
                          <Box m="sm" bg="red">
                            <code>
                              {changeItem.search_block}
                            </code>
                          </Box>
                          <Box m="sm" bg="green">
                            <code>
                              {changeItem.replace_block}
                            </code>
                          </Box>

                          <Button onClick={() => sendChange(changeItem.filepath, changeItem.search_block, changeItem.replace_block)}>Accept change</Button>
                        </Card>
                      ))}
                    </Box>}
                  {!instructionItem.changesCompleted && <Text>Loading changes...</Text>}
                </Box>
              ))}
            </Box>}
          
            <Badge>New Files</Badge>
            {item.newFiles.map((newFileItem, newFileIndex) => (
              <Box>
                <Text style={{ fontWeight: "bold" }}>{newFileItem.filepath}</Text>
                <EnhancedMarkdown message={newFileItem.code}/>
                <Button onClick={() => writeFile(newFileItem.filepath, newFileItem.code)}>Accept new file</Button>
              </Box>
            ))}
          </Tabs.Panel>
        ))}
      </Tabs>
    </Container>
  );
}