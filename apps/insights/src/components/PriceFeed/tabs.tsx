"use client";

import { Tabs as TabsComponent } from "@pythnetwork/component-library/Tabs";
import {
  UnstyledTabPanel,
  UnstyledTabs,
} from "@pythnetwork/component-library/UnstyledTabs";
import { useSelectedLayoutSegment, usePathname } from "next/navigation";
import { useMemo, type ComponentProps } from "react";

import { LayoutTransition } from "../LayoutTransition";

export const TabRoot = (
  props: Omit<ComponentProps<typeof UnstyledTabs>, "selectedKey">,
) => {
  const tabId = useSelectedLayoutSegment() ?? "";

  return <UnstyledTabs selectedKey={tabId} {...props} />;
};

type TabsProps = Omit<
  ComponentProps<typeof TabsComponent>,
  "pathname" | "items"
> & {
  slug: string;
  items: (Omit<
    ComponentProps<typeof TabsComponent>["items"],
    "href" | "id"
  >[number] & {
    segment: string | undefined;
  })[];
};

export const Tabs = ({ slug, items, ...props }: TabsProps) => {
  const pathname = usePathname();
  const mappedItems = useMemo(() => {
    const prefix = `/price-feeds/${slug}`;
    return items.map((item) => ({
      ...item,
      id: item.segment ?? "",
      href: item.segment ? `${prefix}/${item.segment}` : prefix,
    }));
  }, [items, slug]);

  return <TabsComponent pathname={pathname} items={mappedItems} {...props} />;
};

export const TabPanel = ({
  children,
  ...props
}: Omit<ComponentProps<typeof UnstyledTabPanel>, "id">) => {
  const tabId = useSelectedLayoutSegment() ?? "";

  return (
    <UnstyledTabPanel key="tabpanel" id={tabId} {...props}>
      {(args) => (
        <LayoutTransition
          variants={{
            initial: ({ segment }) => ({
              opacity: 0,
              x: segment === null ? "-2%" : "2%",
            }),
            exit: ({ segment }) => ({
              opacity: 0,
              x: segment === null ? "2%" : "-2%",
              transition: {
                x: { type: "spring", bounce: 0 },
              },
            }),
          }}
          initial="initial"
          animate={{
            opacity: 1,
            x: 0,
            transition: {
              x: { type: "spring", bounce: 0 },
            },
          }}
          exit="exit"
        >
          {typeof children === "function" ? children(args) : children}
        </LayoutTransition>
      )}
    </UnstyledTabPanel>
  );
};
