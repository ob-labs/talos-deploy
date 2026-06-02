import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

function Tabs({ value, onValueChange, children, className }: TabsProps) {
  return (
    <div className={cn("w-full", className)} data-value={value}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement<any>(child)) {
          return React.cloneElement(child, { value, onValueChange });
        }
        return child;
      })}
    </div>
  );
}

function TabsList({
  children,
  value,
  onValueChange,
  className,
}: {
  children: React.ReactNode;
  value?: string;
  onValueChange?: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground", className)}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement<any>(child)) {
          return React.cloneElement(child, { activeValue: value, onValueChange });
        }
        return child;
      })}
    </div>
  );
}

function TabsTrigger({
  value: tabValue,
  activeValue,
  onValueChange,
  children,
  className,
}: {
  value: string;
  activeValue?: string;
  onValueChange?: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const isActive = activeValue === tabValue;
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all cursor-pointer",
        isActive ? "bg-background text-foreground shadow" : "hover:bg-background/50",
        className
      )}
      onClick={() => onValueChange?.(tabValue)}
    >
      {children}
    </button>
  );
}

function TabsContent({
  value: tabValue,
  value: activeValue,
  children,
  className,
}: {
  value: string;
  value?: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (activeValue !== tabValue) return null;
  return <div className={cn("mt-4", className)}>{children}</div>;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
