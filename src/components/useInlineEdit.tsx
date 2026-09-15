import { useCallback, useState } from 'react';
import type { Todo } from '../types';
import AddModal from './AddModal';

/**
 * The state every to-do list keeps for editing in place: which one row has
 * its inline editor open (one at a time, owned by the list), and which to-do
 * — if any — has gone on to the full modal via "Advanced…". `editModal` is
 * the modal element to render, or null; the list drops it wherever its
 * portal should mount.
 */
export function useInlineEdit() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Todo | null>(null);

  const toggleExpanded = useCallback((id: string) => setExpandedId((cur) => (cur === id ? null : id)), []);
  const editModal = editing ? <AddModal editTodo={editing} onClose={() => setEditing(null)} /> : null;

  return { expandedId, toggleExpanded, editing, setEditing, editModal };
}
