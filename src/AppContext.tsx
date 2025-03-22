import { createContext, ReactNode, useContext, useState } from "react";
import Calendar from "./Calendar";
import ToDo from "./To-do";
import Habits from "./Habits";

const AppContext = createContext<AppContextInterface>({
      getContext: "App",
      setContext: () => {},
});

export interface AppContextInterface {
      getContext: String;
      setContext: (c: string) => void;
}

export default function ContextWrapper({ children }: { children: ReactNode }) {
      const [getContext, setContext] = useState<String>("Calendar");
      return <AppContext.Provider value={{ getContext, setContext }}>{children}</AppContext.Provider>;
}

export const useAppState = () => {
      return useContext(AppContext);
};

export function AppManager() {
      const { getContext } = useAppState();
      return (
            <>
                  {getContext == "Calendar" && <Calendar />}
                  {getContext == "ToDo" && <ToDo />}
                  {getContext == "Habits" && <Habits />}
            </>
      );
}
