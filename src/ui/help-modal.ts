/**
 * The "how to play" modal, opened by the `?` button and dismissed by the close
 * button or by clicking the backdrop.
 */
export class HelpModal {
  constructor(
    private readonly modal: HTMLElement,
    helpButton: HTMLButtonElement,
    closeButton: HTMLButtonElement,
  ) {
    helpButton.addEventListener("click", () => this.open());

    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.close();
    });

    this.modal.addEventListener("click", (event) => {
      if (event.target === this.modal) {
        this.close();
      }
    });
  }

  open(): void {
    this.modal.classList.remove("hidden");
  }

  close(): void {
    this.modal.classList.add("hidden");
  }
}
