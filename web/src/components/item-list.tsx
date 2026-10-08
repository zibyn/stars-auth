import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { ItemGroup, ItemSeparator } from "#/components/ui/item";

// ItemList is a list of Items on no tint, a rule between each (#76).
export function ItemList({ children }: { children: ReactNode }) {
	return (
		<ItemGroup className="gap-0">
			{Children.toArray(children).map((child, i) => (
				<Fragment key={isValidElement(child) ? child.key : i}>
					{i > 0 && <ItemSeparator className="my-0" />}
					{child}
				</Fragment>
			))}
		</ItemGroup>
	);
}
