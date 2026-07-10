from .leboncoin import Leboncoin
from .pap import Pap

ADAPTERS = {
    "leboncoin": Leboncoin,
    "pap": Pap,
}


def get_adapter(name):
    cls = ADAPTERS.get(name)
    return cls() if cls else None
