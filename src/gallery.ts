interface ImageConfigSize {
  width: number;
  height: number;
  name: string;
}

interface ImageConfig {
  name: string;
  title: string;
  caption: string;
  sizes: ImageConfigSize[];
}

function toCanonicalKey(src: string): string {
  const filename = src.substring(src.lastIndexOf('/') + 1);
  const lastUnderscore = filename.lastIndexOf('_');
  const lastDot = filename.lastIndexOf('.');
  if (lastUnderscore !== -1 && lastDot !== -1 && lastUnderscore < lastDot) {
    return filename.substring(0, lastUnderscore) + filename.substring(lastDot);
  }
  return filename;
}

function getConfigsBySrc(): Map<string, ImageConfig> {
  const configMap = new Map<string, ImageConfig>();
  const dataScript = document.getElementById('gallery-data');
  if (dataScript) {
    try {
      const configs: ImageConfig[] = JSON.parse(dataScript.textContent || '[]');
      configs.forEach(config => {
        configMap.set(config.name, config);
      });
    } catch (error) {
      console.error('Failed to parse gallery metadata', error);
    }
  }
  return configMap;
}

function closeFigure(figure: HTMLElement): void {
  figure.classList.remove('is-active');
  const overlay = figure.querySelector<HTMLElement>('.overlay');
  if (overlay) {
    overlay.setAttribute('aria-hidden', 'true');
  }
}

let savedGridScrollY = 0;

function showGrid(): void {
  const main = document.querySelector('main');
  if (!main) return;
  main.classList.remove('large-image');
  document.querySelectorAll<HTMLElement>('.image-widget.is-active')
      .forEach(activeFigure => closeFigure(activeFigure));
  window.scrollTo({top: savedGridScrollY, behavior: 'instant'});
}

function showImage(scrollToElement: HTMLElement): void {
  const main = document.querySelector('main');
  if (!main) return;
  if (!main.classList.contains('large-image')) {
    savedGridScrollY = window.scrollY;
    history.pushState({galleryView: 'large-image'}, '');
  }
  main.classList.add('large-image');
  setTimeout(() => {
    scrollToElement.scrollIntoView({behavior: 'smooth', block: 'center'});
  }, 50);
}

function isInPhotosGrid(img: HTMLImageElement): boolean {
  return img.closest('div.photos-grid') !== null;
}

function upgradeImageToWidget(
    imgElement: HTMLImageElement, config: ImageConfig): void {
  const figure = document.createElement('figure');
  figure.className = 'image-widget';
  figure.tabIndex = 0;

  const figcaption = document.createElement('figcaption');
  figcaption.className = 'overlay';
  figcaption.setAttribute('aria-hidden', 'true');

  const menu = document.createElement('div');
  menu.className = 'overlay-menu';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'menu-title';
  titleSpan.textContent = config.title || 'Download Sizes';
  menu.appendChild(titleSpan);

  config.sizes.forEach(size => {
    const link = document.createElement('a');
    link.className = 'menu-btn';

    const baseName = config.name.replace(/\.[^/.]+$/, '');
    link.href = `images/${baseName}_${size.name}.jpg`;
    link.target = '_blank';
    link.textContent = `${size.width} x ${size.height}`;

    menu.appendChild(link);
  });

  figcaption.appendChild(menu);

  imgElement.classList.add('clickable-image');
  imgElement.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();

    const main = document.querySelector('main');
    if (isInPhotosGrid(imgElement) && main &&
        !main.classList.contains('large-image')) {
      showImage(figure);
      return;
    }

    // Handle standard overlay toggling for the list view
    document.querySelectorAll<HTMLElement>('.image-widget.is-active')
        .forEach(activeFigure => {
          if (activeFigure !== figure) {
            closeFigure(activeFigure);
          }
        });

    const isActive = figure.classList.toggle('is-active');
    figcaption.setAttribute('aria-hidden', (!isActive).toString());
  });

  figcaption.addEventListener('click', (e: MouseEvent) => {
    if (e.target === figcaption) {
      closeFigure(figure);
    }
  });

  const parent = imgElement.parentNode;
  if (parent) {
    parent.insertBefore(figure, imgElement);
    figure.appendChild(imgElement);
    if (config.caption) {
      const hoverCaption = document.createElement('div');
      hoverCaption.className = 'hover-caption';
      hoverCaption.textContent = config.caption;
      figure.appendChild(hoverCaption);
    }
    figure.appendChild(figcaption);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const configMap = getConfigsBySrc();
  const images = document.querySelectorAll('img');

  images.forEach(img => {
    const src = img.getAttribute('src');
    if (!src) return;
    const config = configMap.get(toCanonicalKey(src));
    if (!config) {
      console.log(`Skip img: ${src} (${toCanonicalKey(src)})`);
      return;
    }
    upgradeImageToWidget(img, config);
  });

  document.addEventListener('click', () => {
    document.querySelectorAll<HTMLElement>('.image-widget.is-active')
        .forEach(figure => closeFigure(figure));
  });

  window.addEventListener('popstate', (e: PopStateEvent) => {
    if (!e.state || e.state.galleryView !== 'large-image') {
      const main = document.querySelector('main');
      if (main && main.classList.contains('large-image')) {
        showGrid();
      }
    }
  });

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      const main = document.querySelector('main');
      if (main && main.classList.contains('large-image')) {
        history.back();
      } else {
        document.querySelectorAll<HTMLElement>('.image-widget.is-active')
            .forEach(figure => closeFigure(figure));
      }
    }
  });
});
