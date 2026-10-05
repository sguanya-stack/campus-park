from .base import Assignment, Policy
from .fifo_policy import FIFOPolicy
from .greedy_policy import GreedyPolicy
from .random_policy import RandomPolicy

# LLM policies (llm_central.LLMCentralPolicy, llm_negotiate.LLMNegotiatePolicy)
# are imported lazily by run_experiment.py only when actually requested,
# since importing them requires the `anthropic` package and (to run, not
# to import) an API key. Keeping them out of this eager import list means
# `python -m harness.run_experiment --strategies random,fifo,greedy` works
# with zero API dependency.

REGISTRY = {
    "random": RandomPolicy,
    "fifo": FIFOPolicy,
    "greedy": GreedyPolicy,
}

__all__ = ["Assignment", "Policy", "RandomPolicy", "FIFOPolicy", "GreedyPolicy", "REGISTRY"]
