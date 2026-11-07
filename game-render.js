
/* ==================================================
   PORT RATING — FLOATING POPOVER
   ================================================== */

function injectRatingStyles() {
    if (document.getElementById("napl-rating-styles")) return;

    const style = document.createElement("style");
    style.id = "napl-rating-styles";

    style.textContent = `
        .port-rating {
            position: relative;
            display: flex;
            align-items: center;
            gap: 7px;
            margin-left: auto;
            flex-shrink: 0;
        }

        .port-rating-stars {
            display: inline-flex;
            color: #e5ad42;
            font-size: 17px;
            letter-spacing: 0;
            white-space: nowrap;
        }

        .port-rating-star {
            position: relative;
            display: inline-block;
            color: #53665f;
        }

        .port-rating-star-fill {
            position: absolute;
            inset: 0 auto 0 0;
            overflow: hidden;
            color: #e5ad42;
            white-space: nowrap;
        }

        .port-rating-average {
            font-size: 13px;
            font-weight: 700;
            white-space: nowrap;
        }

        .port-rating-count {
            color: #9eb7ad;
            font-size: 11px;
            white-space: nowrap;
        }

        .port-rating-button {
            border: 1px solid #438372;
            background: #17483f;
            color: #effaf5;
            border-radius: 7px;
            padding: 6px 10px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
        }

        .port-rating-button:hover {
            background: #216052;
        }

        .port-rating-popover {
            position: absolute;
            z-index: 20;
            top: calc(100% + 10px);
            right: 0;
            width: 260px;
            max-width: min(260px, calc(100vw - 40px));
            padding: 13px;
            background: #12352f;
            border: 1px solid #438372;
            border-radius: 10px;
            box-shadow: 0 12px 30px #0009;
        }

        .port-rating-popover[hidden] {
            display: none;
        }

        .port-rating-popover::before {
            content: "";
            position: absolute;
            top: -6px;
            right: 25px;
            width: 10px;
            height: 10px;
            transform: rotate(45deg);
            background: #12352f;
            border-left: 1px solid #438372;
            border-top: 1px solid #438372;
        }

        .port-rating-popover-title {
            margin: 0 0 4px;
            color: #edf5f0;
            font-size: 14px;
            font-weight: 700;
        }

        .port-rating-popover-description {
            margin: 0 0 10px;
            color: #a8c0b6;
            font-size: 11px;
        }

        .port-rating-option {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            margin-top: 6px;
            padding: 9px 10px;
            border: 1px solid #2c6255;
            border-radius: 7px;
            background: #194239;
            color: #edf5f0;
            font-size: 12px;
            text-align: left;
            cursor: pointer;
        }

        .port-rating-option:hover,
        .port-rating-option.selected {
            border-color: #e5ad42;
            background: #285044;
        }

        .port-rating-option-stars {
            color: #e5ad42;
            letter-spacing: 1px;
        }

        .port-rating-submit {
            display: block;
            width: 100%;
            margin-top: 11px;
            padding: 9px;
            border: 1px solid #438f78;
            border-radius: 7px;
            background: #286b59;
            color: white;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
        }

        .port-rating-submit:disabled {
            opacity: .5;
            cursor: not-allowed;
        }

        .port-rating-feedback {
            margin: 9px 0 0;
            color: #a8c0b6;
            font-size: 11px;
        }

        @media (max-width: 480px) {
            .port-rating {
                gap: 5px;
            }

            .port-rating-stars {
                font-size: 14px;
            }

            .port-rating-average {
                font-size: 12px;
            }

            .port-rating-button {
                padding: 5px 8px;
            }
        }
    `;

    document.head.appendChild(style);
}


function createRatingStars(average) {
    const stars = document.createElement("span");
    stars.className = "port-rating-stars";
    stars.setAttribute("aria-label", `${average.toFixed(1)} out of 5`);

    for (let i = 1; i <= 5; i++) {
        const star = document.createElement("span");
        star.className = "port-rating-star";
        star.textContent = "★";

        const fill = document.createElement("span");
        fill.className = "port-rating-star-fill";
        fill.textContent = "★";

        const percentage = Math.max(
            0,
            Math.min(100, (average - i + 1) * 100)
        );

        fill.style.width = `${percentage}%`;
        star.appendChild(fill);
        stars.appendChild(star);
    }

    return stars;
}


function createPortRating(port) {
    if (!port.portId) return null;

    const container = document.createElement("div");
    container.className = "port-rating";

    // Temporary display values until the ratings API is connected.
    const average = 0;
    const voteCount = 0;

    container.appendChild(createRatingStars(average));

    const averageElement = document.createElement("span");
    averageElement.className = "port-rating-average";
    averageElement.textContent = average
        ? average.toFixed(1)
        : "—";

    container.appendChild(averageElement);

    if (voteCount > 0) {
        const count = document.createElement("span");
        count.className = "port-rating-count";
        count.textContent = `(${voteCount})`;
        container.appendChild(count);
    }

    const rateButton = document.createElement("button");
    rateButton.type = "button";
    rateButton.className = "port-rating-button";
    rateButton.textContent = "Rate";
    rateButton.setAttribute("aria-expanded", "false");

    const popover = document.createElement("div");
    popover.className = "port-rating-popover";
    popover.hidden = true;

    const heading = document.createElement("h4");
    heading.className = "port-rating-popover-title";
    heading.textContent = "Rate this port";

    const description = document.createElement("p");
    description.className = "port-rating-popover-description";
    description.textContent = "Choose your rating";

    popover.append(heading, description);

    const options = [
        "AI Slop",
        "Just emulate it bro",
        "Decent",
        "Good Port",
        "Gem"
    ];

    let selectedRating = 0;

    options.forEach((label, index) => {
        const score = index + 1;

        const option = document.createElement("button");
        option.type = "button";
        option.className = "port-rating-option";

        const optionLabel = document.createElement("span");
        optionLabel.textContent = label;

        const optionStars = document.createElement("span");
        optionStars.className = "port-rating-option-stars";
        optionStars.textContent = "★".repeat(score);

        option.append(optionLabel, optionStars);

        option.addEventListener("click", () => {
            selectedRating = score;

            popover.querySelectorAll(".port-rating-option")
                .forEach(button => {
                    button.classList.toggle(
                        "selected",
                        button === option
                    );
                });

            submit.disabled = false;
            feedback.textContent = `Selected: ${label}`;
        });

        popover.appendChild(option);
    });

    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "port-rating-submit";
    submit.textContent = "Submit vote";
    submit.disabled = true;

    const feedback = document.createElement("p");
    feedback.className = "port-rating-feedback";
    feedback.textContent = "Select one of the five options.";

    submit.addEventListener("click", () => {
        if (!selectedRating) return;

        // Vote submission will be connected to the Worker API.
        feedback.textContent =
            `Selected rating: ${selectedRating}/5.`;

        popover.hidden = true;
        rateButton.setAttribute("aria-expanded", "false");
    });

    popover.append(submit, feedback);

    rateButton.addEventListener("click", event => {
        event.stopPropagation();

        const opening = popover.hidden;

        document.querySelectorAll(".port-rating-popover")
            .forEach(element => {
                element.hidden = true;
            });

        document.querySelectorAll(".port-rating-button")
            .forEach(element => {
                element.setAttribute("aria-expanded", "false");
            });

        popover.hidden = !opening;
        rateButton.setAttribute(
            "aria-expanded",
            String(opening)
        );
    });

    document.addEventListener("click", event => {
        if (!container.contains(event.target)) {
            popover.hidden = true;
            rateButton.setAttribute("aria-expanded", "false");
        }
    });

    container.append(rateButton, popover);

    return container;
}
