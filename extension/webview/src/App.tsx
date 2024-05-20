import React, { useState, useEffect } from 'react';
import { Container, Button, Text, Textarea, Tabs, Card } from '@mantine/core';
import GenerationNode from './lib/Node';
import { Snippet } from './lib/Snippet';
import EnhancedMarkdown from './lib/EnhancedMarkdown';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { notifications } from '@mantine/notifications';
import { VSCodeMessage } from './lib/VSCodeMessage';
import { usePostHog } from 'posthog-js/react'

const SUPABASE_URL = "https://qqlfwjdpxnpoopgibsbm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxbGZ3amRweG5wb29wZ2lic2JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDE0MDM0MjYsImV4cCI6MjAxNjk3OTQyNn0.FfCGI17DLv3Ejsno5--5XyfzCQtCLnoyeTf2cxGgOvc";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function App(){
  let [query, setQuery] = useState("");

  let [currentGenerations, setCurrentGenerations] = useState([]);
  let [snippets, setSnippets] = useState<Snippet[]>([]);
  let [generations, setGenerations] = useState<any[]>([{started: false}]);

  let [userData, setUserData] = useState<any>();
  const posthog = usePostHog();

  useEffect(() => {
    VSCodeMessage.onMessage((message) => {
      if(message.type === "context") {
        if(message.content.telemetryAllowed) {
          posthog.opt_in_capturing();
        } else {
          posthog.opt_out_capturing();
        }
      } else if (message.type === "snippet") {

      }
    });
    VSCodeMessage.postMessage({
      type: "startedWebview"
    });
    // authenticate();
  }, []);

  let launchRequests = async () => { // Should be making multiple requests at the same time.
  
  }

  let processRequest = async () => {
    let url = (process.env.NODE_ENV == "development") ? "https://localhost:8000/" : "";
    let response = await fetch(url, {
      body: JSON.stringify({

      })
    });
    if(!response.ok){
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      let done = false;
      while(!done){
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        let chunkValue = decoder.decode(value);
        setGenerations(JSON.parse(chunkValue));
      }
    }
  }

  let deleteSnippet = (index: number) => {
    setSnippets((prevSnippets: Snippet[]) => {
      return prevSnippets.splice(index, 1);
    });
  }

  let authenticate = async () => {
    const { data, error } = await supabase.auth.signInAnonymously();
    if(error){
      console.error(error);
      notifications.show({
        title: "Error with anonymous authentication",
        message: "Please try again"
      });
    }
    console.log(data);
    setUserData(data);
  }
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
      {generations.map((generation, index) => (
        <>
          {generation["started"] && <>
            {!generation["planCompleted"] && <EnhancedMarkdown message={
              {
                role: "Planning in progress",
                content: generation["progress"]
              }}></EnhancedMarkdown>}
            {generation["planCompleted"] && <>
              IDK find a way to show the plan
              {!generation["changesCompleted"] && <>Changes are loading...</>}
              {generation["changesCompleted"] && <>Here view your changes and hit replace to apply them</>}
            </>}
          </>}
        </>
      ))}

    </Container>
  );
}