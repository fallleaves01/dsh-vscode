/** Eye marks used by the official DSH credential controls. */
const contour = 'M1.5 8C2.9 5.25 5.25 3.5 8 3.5C10.75 3.5 13.1 5.25 14.5 8C13.1 10.75 10.75 12.5 8 12.5C5.25 12.5 2.9 10.75 1.5 8Z'
export function updateSecretIcon(svg: SVGSVGElement, revealed: boolean): void {
  svg.querySelector('path')!.setAttribute('d', contour + (revealed ? 'M2.5 2.5L13.5 13.5' : 'M10 8C10 9.1 9.1 10 8 10C6.9 10 6 9.1 6 8C6 6.9 6.9 6 8 6C9.1 6 10 6.9 10 8Z'))
}
export function secretIcon(document: Document): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.3'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('aria-hidden', 'true')
  svg.append(document.createElementNS('http://www.w3.org/2000/svg', 'path')); updateSecretIcon(svg, false)
  return svg
}
