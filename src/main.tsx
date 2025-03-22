import React from "react";
import ReactDOM from "react-dom/client";
import Sidebar from "./Sidebar";
import "./App.css";
import ContextWrapper from "./AppContext";
import { AppManager } from "./AppContext";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
            <ContextWrapper>
                  <div className="flex h-screen bg-gray-50">
                        <Sidebar />
                        <div className="flex-1 overflow-auto">
                              <AppManager />
                        </div>
                  </div>
            </ContextWrapper>
      </React.StrictMode>
);
