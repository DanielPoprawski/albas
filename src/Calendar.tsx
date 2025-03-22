import { useState, useEffect } from "react";

// TypeScript interfaces
interface Task {
      id: string;
      title: string;
      completed: boolean;
      date: string;
}

interface CalendarDay {
      date: Date;
      isCurrentMonth: boolean;
      tasks: Task[];
}

export default function Calendar() {
      // State
      const [currentDate, setCurrentDate] = useState<Date>(new Date());
      const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
      const [tasks, setTasks] = useState<Task[]>([]);
      const [newTask, setNewTask] = useState<string>("");
      const [selectedDate, setSelectedDate] = useState<Date | null>(null);

      // Generate calendar days for the current month
      useEffect(() => {
            const generateCalendarDays = () => {
                  const year = currentDate.getFullYear();
                  const month = currentDate.getMonth();

                  // First day of the month
                  const firstDayOfMonth = new Date(year, month, 1);
                  // Last day of the month
                  const lastDayOfMonth = new Date(year, month + 1, 0);

                  // Day of the week of the first day (0 = Sunday, 6 = Saturday)
                  const firstDayWeekday = firstDayOfMonth.getDay();

                  // Days in the month
                  const daysInMonth = lastDayOfMonth.getDate();

                  // Array to hold all calendar days
                  const days: CalendarDay[] = [];

                  // Add days from previous month to fill the first week
                  const prevMonthLastDay = new Date(year, month, 0).getDate();
                  for (let i = firstDayWeekday - 1; i >= 0; i--) {
                        days.push({
                              date: new Date(year, month - 1, prevMonthLastDay - i),
                              isCurrentMonth: false,
                              tasks: [],
                        });
                  }

                  // Add days of current month
                  for (let day = 1; day <= daysInMonth; day++) {
                        const date = new Date(year, month, day);
                        days.push({
                              date,
                              isCurrentMonth: true,
                              tasks: tasks.filter((task) => new Date(task.date).toDateString() === date.toDateString()),
                        });
                  }

                  // Add days from next month to complete the grid (6 rows x 7 days = 42 cells)
                  const remainingDays = 42 - days.length;
                  for (let day = 1; day <= remainingDays; day++) {
                        days.push({
                              date: new Date(year, month + 1, day),
                              isCurrentMonth: false,
                              tasks: [],
                        });
                  }

                  setCalendarDays(days);
            };

            generateCalendarDays();
      }, [currentDate, tasks]);

      // Handle month navigation
      const previousMonth = () => {
            setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
      };

      const nextMonth = () => {
            setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
      };

      // Handle date selection
      const handleDateClick = (day: CalendarDay) => {
            setSelectedDate(day.date);
      };

      // Handle task creation
      const handleAddTask = () => {
            if (newTask.trim() === "" || !selectedDate) return;

            const task: Task = {
                  id: Date.now().toString(),
                  title: newTask,
                  completed: false,
                  date: selectedDate.toISOString(),
            };

            setTasks([...tasks, task]);
            setNewTask("");
      };

      // Handle task completion toggle
      const toggleTaskCompletion = (taskId: string) => {
            setTasks(tasks.map((task) => (task.id === taskId ? { ...task, completed: !task.completed } : task)));
      };

      // Handle task deletion
      const deleteTask = (taskId: string) => {
            setTasks(tasks.filter((task) => task.id !== taskId));
      };

      // Format the month and year
      const formatMonthYear = (date: Date) => {
            return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      };

      // Days of the week
      const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

      // Get tasks for the selected date
      const selectedDateTasks = selectedDate
            ? tasks.filter((task) => new Date(task.date).toDateString() === selectedDate.toDateString())
            : [];

      return (
            <div className="flex flex-col h-screen bg-gradient-to-b from-gray-800 to-gray-700 text-white">
                  {/* Header */}
                  <header className="p-4 flex justify-between items-center border-b border-gray-600">
                        <h1 className="text-3xl font-bold">Task Calendar</h1>
                  </header>

                  {/* Main Content */}
                  <div className="flex flex-1 overflow-hidden">
                        {/* Calendar */}
                        <div className="w-3/4 p-4 overflow-auto">
                              {/* Month Navigation */}
                              <div className="flex justify-between items-center mb-4">
                                    <button
                                          onClick={previousMonth}
                                          className="p-2 rounded hover:bg-gray-600 focus:outline-none"
                                    >
                                          &lt; Prev
                                    </button>
                                    <h2 className="text-xl font-semibold">{formatMonthYear(currentDate)}</h2>
                                    <button
                                          onClick={nextMonth}
                                          className="p-2 rounded hover:bg-gray-600 focus:outline-none"
                                    >
                                          Next &gt;
                                    </button>
                              </div>

                              {/* Calendar Grid */}
                              <div className="grid grid-cols-7 gap-1">
                                    {/* Weekday Headers */}
                                    {weekdays.map((day) => (
                                          <div key={day} className="p-2 text-center font-medium text-gray-300">
                                                {day}
                                          </div>
                                    ))}

                                    {/* Calendar Days */}
                                    {calendarDays.map((day, index) => (
                                          <div
                                                key={index}
                                                onClick={() => handleDateClick(day)}
                                                className={`
                  p-2 h-24 border border-gray-600 overflow-hidden hover:bg-gray-600 cursor-pointer transition-colors
                  ${day.isCurrentMonth ? "bg-gray-700" : "bg-gray-800 text-gray-500"}
                  ${
                        selectedDate && day.date.toDateString() === selectedDate.toDateString()
                              ? "ring-2 ring-indigo-500"
                              : ""
                  }
                  ${new Date().toDateString() === day.date.toDateString() ? "font-bold text-indigo-300" : ""}
                `}
                                          >
                                                <div className="flex justify-between items-start">
                                                      <span>{day.date.getDate()}</span>
                                                      {day.tasks.length > 0 && (
                                                            <span className="text-xs bg-indigo-600 px-1 rounded-full">
                                                                  {day.tasks.length}
                                                            </span>
                                                      )}
                                                </div>
                                                <div className="mt-1 space-y-1 overflow-hidden max-h-16">
                                                      {day.tasks.slice(0, 2).map((task) => (
                                                            <div
                                                                  key={task.id}
                                                                  className={`
                        text-xs truncate px-1 py-0.5 rounded
                        ${task.completed ? "line-through opacity-50" : ""}
                      `}
                                                            >
                                                                  {task.title}
                                                            </div>
                                                      ))}
                                                      {day.tasks.length > 2 && (
                                                            <div className="text-xs text-gray-400">
                                                                  +{day.tasks.length - 2} more
                                                            </div>
                                                      )}
                                                </div>
                                          </div>
                                    ))}
                              </div>
                        </div>

                        {/* Task Panel */}
                        <div className="border-l border-gray-600 p-4 overflow-auto">
                              <h2 className="text-xl font-semibold mb-4">
                                    {selectedDate
                                          ? selectedDate.toLocaleDateString("en-US", {
                                                  weekday: "long",
                                                  month: "long",
                                                  day: "numeric",
                                            })
                                          : "Notes..."}
                              </h2>

                              {selectedDate && (
                                    <>
                                          {/* Add Task Form */}
                                          <div className="mb-6">
                                                <div className="flex mb-2">
                                                      <input
                                                            type="text"
                                                            value={newTask}
                                                            onChange={(e) => setNewTask(e.target.value)}
                                                            placeholder="New task..."
                                                            className="flex-1 p-2 rounded-l bg-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                                      />
                                                      <button
                                                            onClick={handleAddTask}
                                                            className="px-4 py-2 bg-indigo-600 rounded-r hover:bg-indigo-700 focus:outline-none"
                                                      >
                                                            Add
                                                      </button>
                                                </div>
                                          </div>

                                          {/* Tasks List */}
                                          <div className="space-y-2">
                                                <h3 className="font-medium text-gray-300">
                                                      Tasks ({selectedDateTasks.length})
                                                </h3>
                                                {selectedDateTasks.length === 0 ? (
                                                      <p className="text-gray-400 italic">No tasks for this day</p>
                                                ) : (
                                                      <div className="space-y-2">
                                                            {selectedDateTasks.map((task) => (
                                                                  <div
                                                                        key={task.id}
                                                                        className={`
                                                                              p-3 rounded bg-gray-700 border-l-4
                                                                              `}
                                                                  >
                                                                        <div className="flex items-center justify-between">
                                                                              <div className="flex items-center space-x-2">
                                                                                    <input
                                                                                          type="checkbox"
                                                                                          checked={task.completed}
                                                                                          onChange={() =>
                                                                                                toggleTaskCompletion(
                                                                                                      task.id
                                                                                                )
                                                                                          }
                                                                                          className="h-4 w-4 rounded"
                                                                                    />
                                                                                    <span
                                                                                          className={
                                                                                                task.completed
                                                                                                      ? "line-through text-gray-400"
                                                                                                      : ""
                                                                                          }
                                                                                    >
                                                                                          {task.title}
                                                                                    </span>
                                                                              </div>
                                                                              <button
                                                                                    onClick={() => deleteTask(task.id)}
                                                                                    className="text-gray-400 hover:text-red-400"
                                                                              >
                                                                                    ×
                                                                              </button>
                                                                        </div>
                                                                  </div>
                                                            ))}
                                                      </div>
                                                )}
                                          </div>
                                    </>
                              )}
                        </div>
                  </div>
            </div>
      );
}
