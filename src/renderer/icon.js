import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export function renderIcon(Icon, size = 15) {
  return renderToStaticMarkup(createElement(Icon, { size }));
}
