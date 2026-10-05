import { DEFAULT_COLOR } from '../../colors';
import { useApp } from '../../context/AppContext';
import { bySort, GENERAL, isDone, isTask, moveSorted, nextSort } from '../../seedLogic';
import { TAG_ICONS } from '../../tagIcons';
import { SidebarSection, ToggleRow } from './SidebarSection';

/**
 * The sidebar's two organising sections: Lists (with the unfiled "General"
 * row first) and Tags. Each row is a visibility tick — hiding a list or a
 * tag hides its seeds on every screen — plus the management menu.
 */
export function SidebarOrganize() {
  const {
    seeds,
    lists,
    tags,
    addList,
    updateList,
    deleteList,
    addTag,
    updateTag,
    deleteTag,
    hiddenListIds,
    toggleHiddenList,
    setHiddenListIds,
    hiddenTagIds,
    toggleHiddenTag,
    setHiddenTagIds,
    activeView,
    showCompleted,
    setShowCompleted,
  } = useApp();

  const sortedLists = [...lists].sort(bySort);
  const sortedTags = [...tags].sort(bySort);
  const openTasks = seeds.filter((s) => isTask(s) && !isDone(s));
  const completedCount = seeds.filter((s) => isTask(s) && isDone(s)).length;

  return (
    <>
      <SidebarSection
        title="Lists"
        noun="list"
        fixedRows={[{ id: '', name: GENERAL }]}
        rows={sortedLists}
        count={(id) => openTasks.filter((s) => s.list === id).length}
        hidden={hiddenListIds}
        onToggle={toggleHiddenList}
        setHidden={setHiddenListIds}
        onAdd={(name) => addList({ name, sort: nextSort(lists) })}
        onRename={(id, name) => updateList(id, { name })}
        onMove={(id, dir) => {
          for (const { id: target, sort } of moveSorted(sortedLists, id, dir) ?? []) updateList(target, { sort });
        }}
        onDelete={deleteList}
        footer={
          activeView === 'todos' && (
            <ToggleRow
              label="Completed"
              checked={showCompleted}
              count={completedCount}
              onToggle={() => setShowCompleted(!showCompleted)}
            />
          )
        }
      />
      <SidebarSection
        title="Tags"
        noun="tag"
        rows={sortedTags}
        count={(id) => seeds.filter((s) => s.tags.includes(id)).length}
        hidden={hiddenTagIds}
        onToggle={toggleHiddenTag}
        setHidden={setHiddenTagIds}
        onAdd={(name) => addTag({ name, color: DEFAULT_COLOR, icon: TAG_ICONS[0], sort: nextSort(tags), keywords: '' })}
        onRename={(id, name) => updateTag(id, { name })}
        onMove={(id, dir) => {
          for (const { id: target, sort } of moveSorted(sortedTags, id, dir) ?? []) updateTag(target, { sort });
        }}
        onDelete={deleteTag}
        onColor={(id, color) => updateTag(id, { color })}
        onIcon={(id, icon) => updateTag(id, { icon })}
      />
    </>
  );
}
