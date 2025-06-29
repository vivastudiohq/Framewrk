import React, { useState, useEffect } from "react";
import Tree from "react-d3-tree";

const CLIENT_ID = "109449587824-6suqjt71pou46ffpr8bjdo2ovn5jcsg6.apps.googleusercontent.com";
const API_KEY = "AIzaSyBm33MmgVHFCUxJLp4cbLB9GIvZYkLC4k4";
const SCOPES = "https://www.googleapis.com/auth/drive.readonly";
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

type TreeNode = {
  name: string;
  children?: TreeNode[];
};

function parseIdeas(text: string): TreeNode {
  // Simple parser: each line is a node, indented lines are children
  const lines = text.split("\n").filter(Boolean);
  const stack: { node: TreeNode; indent: number }[] = [];
  let root: TreeNode = { name: "Document", children: [] };

  lines.forEach((line) => {
    const indent = line.search(/\S/);
    const node: TreeNode = { name: line.trim() };
    if (stack.length === 0) {
      root.children!.push(node);
      stack.push({ node, indent });
    } else {
      while (stack.length && indent <= stack[stack.length - 1].indent) {
        stack.pop();
      }
      if (stack.length) {
        const parent = stack[stack.length - 1].node;
        parent.children = parent.children || [];
        parent.children.push(node);
      } else {
        root.children!.push(node);
      }
      stack.push({ node, indent });
    }
  });

  return root;
}

const App: React.FC = () => {
  // Google Docs revision viewer state
  const [tokenClient, setTokenClient] = useState<any>(null);
  const [gapiInited, setGapiInited] = useState(false);
  const [gisInited, setGisInited] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docId, setDocId] = useState("");
  const [revisionsContent, setRevisionsContent] = useState<{id: string, modifiedTime: string, content: string}[]>([]);
  const [loading, setLoading] = useState(false);

  // Mind map state
  const [treeData, setTreeData] = useState<TreeNode | null>(null);

  // Load gapi and GIS scripts
  useEffect(() => {
    function gapiLoaded() {
      window.gapi.load("client", async () => {
        await window.gapi.client.init({
          apiKey: API_KEY,
          discoveryDocs: [DISCOVERY_DOC],
        });
        setGapiInited(true);
      });
    }
    function gisLoaded() {
      const tc = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: "", // will set later
      });
      setTokenClient(tc);
      setGisInited(true);
    }

    if (!window.gapi) {
      const script = document.createElement("script");
      script.src = "https://apis.google.com/js/api.js";
      script.async = true;
      script.defer = true;
      script.onload = gapiLoaded;
      document.body.appendChild(script);
    } else {
      gapiLoaded();
    }

    if (!window.google || !window.google.accounts) {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = gisLoaded;
      document.body.appendChild(script);
    } else {
      gisLoaded();
    }
    // eslint-disable-next-line
  }, []);

  // Sign in and get token
  const handleSignIn = () => {
    setError(null);
    if (!gapiInited || !gisInited || !tokenClient) {
      setError("Google API not loaded yet.");
      return;
    }
    tokenClient.callback = async (resp: any) => {
      if (resp.error !== undefined) {
        setError("Sign-in failed");
        return;
      }
      setToken(resp.access_token);
    };
    if (window.gapi.client.getToken() === null) {
      tokenClient.requestAccessToken({ prompt: "consent" });
    } else {
      tokenClient.requestAccessToken({ prompt: "" });
    }
  };

  // Helper: Extract Google Doc ID from URL
  function extractDocId(url: string): string | null {
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  }

  // Fetch and display all revision contents
  const fetchAllRevisionContents = async () => {
    setError(null);
    setRevisionsContent([]);
    setLoading(true);
    let id = docId;
    if (id.includes("/d/")) {
      id = extractDocId(id) || "";
    }
    if (!token || !id) {
      setError("Missing token or document ID.");
      setLoading(false);
      return;
    }
    try {
      window.gapi.client.setToken({ access_token: token });
      // 1. List revisions
      const revRes = await window.gapi.client.drive.revisions.list({
        fileId: id,
        fields: "revisions(id, modifiedTime, exportLinks)"
      });
      const revisions = revRes.result.revisions || [];
      // 2. For each revision, fetch plain text content if available
      const contents = await Promise.all(
        revisions.map(async (rev: any) => {
          if (rev.exportLinks && rev.exportLinks["text/plain"]) {
            const resp = await fetch(rev.exportLinks["text/plain"], {
              headers: { Authorization: `Bearer ${token}` }
            });
            const text = await resp.text();
            return { id: rev.id, modifiedTime: rev.modifiedTime, content: text };
          } else {
            return { id: rev.id, modifiedTime: rev.modifiedTime, content: "(No plain text export available)" };
          }
        })
      );
      setRevisionsContent(contents);
      // Print each revision's content to the console
      contents.forEach(rev => {
        console.log(`Revision ${rev.id} (${rev.modifiedTime}):\n${rev.content}`);
      });
    } catch (err: any) {
      setError(err.message || "Failed to fetch revisions");
    }
    setLoading(false);
  };

  // Handle TXT file upload and parse as tree
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const tree = parseIdeas(text);
      setTreeData(tree);
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ padding: 24, width: "100vw", minHeight: "100vh" }}>
      <h1>Idea Graph Visualizer & Google Doc Revision Viewer</h1>
      <div style={{ marginBottom: 24 }}>
        <input type="file" accept=".txt" onChange={handleFile} />
        <span style={{ marginLeft: 8, fontWeight: 500 }}>Upload .txt for Mind Map</span>
      </div>
      {treeData && (
        <div style={{ width: "100%", height: "60vh", marginBottom: 32 }}>
          <h3>Mind Map:</h3>
          <Tree data={treeData} orientation="vertical" />
        </div>
      )}
      <hr />
      <button onClick={handleSignIn}>Sign in with Google</button>
      {token && (
        <div style={{ marginTop: 16 }}>
          <input
            type="text"
            placeholder="Paste Google Doc link or ID"
            value={docId}
            onChange={e => setDocId(e.target.value)}
            style={{ width: "300px" }}
          />
          <button onClick={fetchAllRevisionContents} disabled={!docId || loading} style={{ marginLeft: 8 }}>
            {loading ? "Loading..." : "Fetch All Revision Contents"}
          </button>
        </div>
      )}
      {error && <div style={{ color: "red", marginTop: 16 }}>{error}</div>}
      {revisionsContent.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3>Revision Contents:</h3>
          {revisionsContent.map((rev) => (
            <div key={rev.id} style={{ marginBottom: 24, border: "1px solid #ccc", padding: 12 }}>
              <div>
                <strong>Revision {rev.id}</strong> - {rev.modifiedTime}
              </div>
              <pre style={{ whiteSpace: "pre-wrap", background: "#f9f9f9", padding: 8, borderRadius: 4 }}>
                {rev.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
export default App;