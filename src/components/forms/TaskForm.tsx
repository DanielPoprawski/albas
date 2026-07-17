import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { Task } from '../../types';
import { inputClass, labelClass, SubmitButton } from './shared';

export default function TaskForm({ edit, onDone }: { edit?: Task; onDone: () => void }) {
  const { addTask, updateTask, selectedDate } = useApp();
  const [title, setTitle] = useState(edit?.title ?? '');
  const [category, setCategory] = useState(edit?.category ?? '');
  const [date, setDate] = useState(edit ? edit.date ?? '' : selectedDate ?? '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const fields = {
      title: title.trim(),
      category: category.trim() || 'General',
      date: date || null,
    };
    if (edit) updateTask(edit.id, fields);
    else addTask(fields.title, fields.category, fields.date);
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-md">
      <div>
        <label className={labelClass}>Title</label>
        <input
          className={inputClass}
          placeholder="What needs to be done?"
          value={title}
          onChange={e => setTitle(e.target.value)}
          autoFocus
        />
      </div>
      <div>
        <label className={labelClass}>Category</label>
        <input
          className={inputClass}
          placeholder="e.g. Work, Personal"
          value={category}
          onChange={e => setCategory(e.target.value)}
        />
      </div>
      <div>
        <label className={labelClass}>Date (optional)</label>
        <input
          type="date"
          className={inputClass}
          value={date}
          onChange={e => setDate(e.target.value)}
          style={{ colorScheme: 'dark' }}
        />
      </div>
      <SubmitButton label={edit ? 'Save Changes' : 'Add Task'} />
    </form>
  );
}
