import {
  DynamicBorder,
  getSelectListTheme,
  keyHint,
  rawKeyHint,
  type ExtensionUIContext,
} from "@code-yeongyu/senpi";
import { Container, SelectList, Spacer, Text } from "@earendil-works/pi-tui";
import type { WorkflowDescriptor } from "./discovery.ts";

export function pickWorkflow(
  ui: ExtensionUIContext,
  descriptors: readonly WorkflowDescriptor[],
): Promise<WorkflowDescriptor | undefined> {
  const rows = new Map(
    descriptors.map((descriptor, index) => [String(index), descriptor]),
  );
  return ui.custom<WorkflowDescriptor | undefined>(
    (tui, theme, _keys, done) => {
      const list = new SelectList(
        [...rows].map(([value, descriptor]) => ({
          value,
          label: `${descriptor.title} [${descriptor.key}]`,
        })),
        Math.max(5, Math.floor(tui.terminal.rows / 2)),
        getSelectListTheme(),
      );
      list.onSelect = (item) => done(rows.get(item.value));
      list.onCancel = () => done(undefined);
      const container = new Container();
      container.addChild(new DynamicBorder());
      container.addChild(new Spacer(1));
      container.addChild(
        new Text(theme.fg("accent", theme.bold("Workflow program")), 1, 0),
      );
      container.addChild(new Spacer(1));
      container.addChild(list);
      container.addChild(new Spacer(1));
      container.addChild(
        new Text(
          `${rawKeyHint("↑↓", "navigate")}  ${keyHint("tui.select.confirm", "select")}  ${keyHint("tui.select.cancel", "cancel")}`,
          1,
          0,
        ),
      );
      container.addChild(new Spacer(1));
      container.addChild(new DynamicBorder());
      return {
        render: (width) => container.render(width),
        invalidate: () => container.invalidate(),
        handleInput: (data) => {
          list.handleInput(
            data === "j" ? "\x1b[B" : data === "k" ? "\x1b[A" : data,
          );
          tui.requestRender();
        },
      };
    },
  );
}
