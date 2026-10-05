import { useApp } from '../../context/AppContext';
import { fmt } from '../../dates';
import { byImportanceThenDue, bySort, GENERAL, groupByList, isDone, isTask } from '../../seedLogic';
import type { Seed } from '../../types';
import { SectionHeading } from '../ui/section-heading';
import { useInlineEdit } from '../useInlineEdit';
import { TaskRow } from './TaskRow';

/**
 * One-time to-dos, grouped by list with unfiled first and completed ones
 * collected at the bottom. "Completed" is a section, not a list: finishing a
 * to-do shouldn't move it out of the group it belongs to, so it keeps its
 * list and star and simply stops competing for attention.
 */
export function TasksSection({ onEdit }: { onEdit: (s: Seed) => void }) {
  const { seeds, lists, listById, isVisible } = useApp();
  const { expandedId, toggleExpanded } = useInlineEdit();
  const today = fmt(new Date());

  const tasks = seeds.filter((s) => isTask(s) && isVisible(s));
  const rowProps = (task: Seed) => ({
    task,
    today,
    onEdit,
    expanded: expandedId === task.id,
    onToggleExpand: () => toggleExpanded(task.id),
    className: 'px-2 py-1.5',
  });
  const order = [...lists].sort(bySort).map((l) => l.id);
  const groups = groupByList(
    tasks.filter((t) => !isDone(t)),
    order,
  );
  const completed = tasks.filter(isDone).sort(byImportanceThenDue);

  if (tasks.length === 0) return null;

  return (
    <div>
      {groups.map(({ list, seeds: rows }) => (
        <div key={list || GENERAL} className="mb-md">
          <SectionHeading className="mb-xs">{listById(list)?.name ?? GENERAL}</SectionHeading>
          <div className="list-rows">
            {rows.map((task) => (
              <TaskRow key={task.id} {...rowProps(task)} />
            ))}
          </div>
        </div>
      ))}

      {completed.length > 0 && (
        <div className="mb-md">
          <SectionHeading className="mb-xs" count={completed.length}>
            Completed
          </SectionHeading>
          <div className="list-rows">
            {completed.map((task) => (
              <TaskRow key={task.id} {...rowProps(task)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
