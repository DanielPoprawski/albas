import type { Props } from './addModal/catalog';
import { CreateModal } from './addModal/CreateModal';
import { EditModal } from './addModal/EditModal';

/**
 * Two modes behind one prop surface:
 * - **create** — the redesigned chip UI, wired straight to addEvent/addTodo.
 * - **edit** — the existing EventForm/TodoForm inside the same chrome. They
 *   already own update, delete, and the recurring "this / all / from here"
 *   choices, none of which the chip UI has controls for.
 */
export default function AddModal(props: Props) {
  if (props.editTodo || props.editEvent) return <EditModal {...props} />;
  return <CreateModal {...props} />;
}
