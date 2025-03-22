import { Calendar, List, Repeat } from "lucide-react";
import { useAppState } from "./AppContext";

export default function Sidebar() {
      const { setContext } = useAppState();

      return (
            <div className="flex flex-col p-4 bg-gray-900 shadow-md">
                  <div className="flex flex-col space-y-2 text-center">
                        <button
                              className="p-2 mx-auto text-white rounded hover:bg-gray-400 text-center"
                              onClick={() => setContext("Calendar")}
                        >
                              <Calendar className="w-8 h-8 mx-auto" />
                        </button>
                        <button
                              className="p-2 mx-auto text-white rounded hover:bg-gray-400 text-center "
                              onClick={() => setContext("ToDo")}
                        >
                              <List className="w-8 h-8 mx-auto" />
                        </button>
                        <button
                              className="p-2 mx-auto text-white rounded hover:bg-gray-400 text-center "
                              onClick={() => setContext("Habits")}
                        >
                              <Repeat className="w-8 h-8 mx-auto" />
                        </button>
                  </div>
            </div>
      );
}
