const EVENT_TYPES = {
    CREATE_OBJECT:'CREATE_OBJECT',
    DELETE_OBJECT:'DELETE_OBJECT',
    CREATE_PROPERTY:'CREATE_PROPERTY',
    SET_PROPERTY:'SET_PROPERTY',
    DELETE_PROPERTY:'DELETE_PROPERTY',

    CREATE_ARRAY:'CREATE_ARRAY',
    INSERT_ELEMENT:'INSERT_ELEMENT',
    DELETE_ELEMENT:'DELETE_ELEMENT',
    DELETE_ARRAY:'DELETE_ARRAY',
}

class ObjectSyncProtocol {
    constructor(settings) {
        settings = settings || {}
        this.objs = {}
        this.listeners = []
        this.host = settings.host || this.makeGUID()
        this.waitBuffer = []
        this.historyBuffer = []
    }
    makeGUID() {
        return Math.floor(Math.random()*100000000) + ""
    }

    isValidOperation(op) {
        if(op.type === EVENT_TYPES.CREATE_PROPERTY) {
            const obj = this.getObjectById(op.object)
            if(!obj) return false
        }
        if(op.type === EVENT_TYPES.SET_PROPERTY) {
            const obj = this.getObjectById(op.object)
            if(!obj) return false
        }
        if(op.type === EVENT_TYPES.DELETE_PROPERTY) {
            const obj = this.getObjectById(op.object)
            if(!obj) return false
        }
        if(op.type === EVENT_TYPES.DELETE_OBJECT) {
            const obj = this.getObjectById(op.id)
            if(!obj) return false
        }
        if(op.type === EVENT_TYPES.INSERT_ELEMENT) {
            const array = this.getObjectById(op.array)
            if(!array) return false
        }
        if(op.type === EVENT_TYPES.DELETE_ELEMENT) {
            const array = this.getObjectById(op.array)
            if(!array) return false
        }
        return true
    }

    retryWaitBuffer() {
        // console.log("::: retrying")
        let i = 0
        while(i < this.waitBuffer.length) {
            const op = this.waitBuffer[i]
            if(this.isValidOperation(op)) {
                console.log("re-trying op",op)
                this.process(op)
                this.waitBuffer.splice(i,1)
            }
            i++
        }
    }
    process(op) {
        // console.log(`${this.getHostId()}:processing op`,op)

        if(!this.isValidOperation(op)) {
            console.log("the operation is not valid. might be in the future")
            this.waitBuffer.push(op)
            return
        }

        this.historyBuffer.push(op)

        if(op.type === EVENT_TYPES.CREATE_OBJECT) {
            const obj = {
                _id:op.id,
                _type:'object',
            }
            if(this.objs[obj._id]) {
                console.log(`object ${obj._id} already exists. don't fire or change`)
                return obj._id
            }
            this.objs[obj._id] = obj

            this.fire(op)
            this.retryWaitBuffer()
            return obj._id
        }
        if(op.type === EVENT_TYPES.CREATE_PROPERTY) {
            const obj = this.getObjectById(op.object)
            if(!obj) return console.error(`Cannot create property ${op.name} on object ${op.object} that does not exist`)
            if(obj[op.name]) return console.log("property already exists. don't fire or change")
            obj[op.name] = op.value
            this.fire(op)
            return
        }
        if(op.type === EVENT_TYPES.SET_PROPERTY) {
            const obj = this.getObjectById(op.object)
            if(!obj) return console.error(`Cannot set property ${op.name} on object ${op.object} that does not exist`)
            if(obj[op.name] === op.value) return console.log("property already has this value, don't fire or change")
            obj[op.name] = op.value
            this.fire(op)
            return
        }
        if(op.type === EVENT_TYPES.DELETE_PROPERTY) {
            const obj = this.getObjectById(op.object)
            if(!obj) return console.error(`cannot delete property on object ${ob.object} that does not exist`)
            if(!obj.hasOwnProperty(op.name)) return console.error(`object doesn't have the property ${op.name}`)
            delete obj[op.name]
            this.fire(op)
            return
        }
        if(op.type === EVENT_TYPES.DELETE_OBJECT) {
            const obj = this.getObjectById(op.id)
            if(!obj) return console.error(`no such object exists with id ${op.id}`)
            delete this.objs[obj._id]
            this.fire(op)
            return
        }

        if(op.type === EVENT_TYPES.CREATE_ARRAY) {
            const arr = {
                _id: op.id,
                _type: 'array',
                _elements: []
            }
            if (this.objs[arr._id]) {
                console.log("array already exists. don't fire or change")
                return arr._id
            }
            this.objs[arr._id] = arr
            this.fire(op)
            this.retryWaitBuffer()
            return arr._id
        }

        if(op.type === EVENT_TYPES.INSERT_ELEMENT) {
            // console.log("working on insert element")
            const arr = this.getObjectById(op.array)
            if (!arr) return console.error(`Cannot insert element into ${op.array} that does not exist`);
            //check if already in there. id p entryid and prev is the same
            if(arr._elements.some(e=>e._id === op.entryid && e._prev === op.prev)) {
                console.log("already processed this insertion. don't fire or change")
                return
            }
            // console.log("inserting",op.value,'after',op.prev,'into',arr,'with id',op.entryid)

            const elem = {
                _id:op.entryid,
                _value:op.value,
                _prev:op.prev,
                _timestamp:op.timestamp,
                _tombstone:false
            }
            //calculate the index of the prev
            const index = arr._elements.findIndex(e => e._id === op.prev)
            // console.log("index of prev is",index)

            const curr = arr._elements[index+1]
            //two forms of insert
            if(curr && curr._prev === elem._prev) {
                // console.log(this.id, "must decide", elem._id, elem._timestamp, curr._id, curr._timestamp)
                if(elem._timestamp > curr._timestamp) {
                    // console.log('new elem first')
                    arr._elements.splice(index+1,0,elem)
                } else if(elem._timestamp < curr._timestamp) {
                    // console.log("new elem second")
                    arr._elements.splice(index+2,0,elem)
                } else {
                    // console.log("same time. go with earliest id")
                    if(elem._id > curr._id) {
                        // console.log('first')
                        arr._elements.splice(index+1,0,elem)
                    } else {
                        // console.log("second")
                        arr._elements.splice(index+2,0,elem)
                    }
                }
            } else {
                arr._elements.splice(index+1,0,elem)
            }
            // console.log("final array is",arr)
            this.fire(op)
            return
        }

        if(op.type === EVENT_TYPES.DELETE_ELEMENT) {
            const arr = this.getObjectById(op.array)
            const elem = arr._elements.find(elem => elem._id === op.entry)
            elem._tombstone = true
            // console.log("final array is",arr)
            this.fire(op)
            return
        }


        console.log(`CANNOT process operation of type ${op.type}`)
    }
    getObjectById(objid) {
        return this.objs[objid]
    }

    hasObject(objid) {
        return typeof this.objs[objid] !== 'undefined'
    }

    getArrayLength(arrid) {
        const arr = this.getObjectById(arrid)
        if (!arr) return console.error(`Cannot get array length for array ${arrid} that does not exist`);
        let len = 0
        arr._elements.forEach(el => {
            if(el._tombstone === false) len++
        })
        return len
    }
    getElementAt(arrid,index) {
        const arr = this.getObjectById(arrid)
        if (!arr) return console.error(`Cannot get element from array ${arrid} that does not exist`);
        // console.log('real array length',arr._elements.length)
        // console.log("logical array length",this.getArrayLength(arrid))
        let count = 0
        for(let i=0; i<arr._elements.length; i++) {
            const elem = arr._elements[i]
            if(elem._tombstone) continue
            // console.log("checking",index,count,elem)
            if(count === index) return elem._value
            count++
        }
        return console.error(`cannot find element for array ${arrid} at index ${index}`)
    }

    getHostId() {
        return this.host
    }

    onChange(cb) {
        this.listeners.push(cb)
    }
    offChange(cb) {
        const n = this.listeners.indexOf(cb)
        if(n >= 0) this.listeners.splice(n,1)
    }
    fire(event) {
        this.listeners.forEach(cb => cb(event))
    }

    getObjectByProperty(key,value) {
        for(let id in this.objs) {
            const obj = this.objs[id]
            if(obj[key] === value) return obj._id
        }
        return null
    }

    getPropertiesForObject(objid) {
        const obj = this.getObjectById(objid)
        if(!obj) return console.error(`cannot get properties for object ${objid} that does not exist not exist`)
        return Object.keys(obj)
            .filter(key => key !== '_id')
            .filter(key => key !== '_type')
    }
    getPropertyValue(objid, key) {
        const obj = this.getObjectById(objid)
        if(!obj) return console.error(`cannot get property value for object ${objid} that does not exist not exist`)
        return obj[key]
    }
    hasPropertyValue(objid,key) {
        const obj = this.getObjectById(objid)
        if(obj) return obj.hasOwnProperty(key)
        return false
    }

    getHistory() {
        return this.historyBuffer.slice()
    }

    dumpGraph() {
        const graph = {}
        Object.keys(this.objs).forEach(key => {
            const obj = this.objs[key]
            let id = obj._id
            if(obj.id) id = obj.id
            graph[id] = {}

            if(obj._type === 'array'){
                graph[id] = []
                obj._elements.forEach((el=>{
                    // console.log("looking at element",el)
                    if(el._tombstone === false) graph[id].push(el._value)
                }))
                return;
            }

            Object.keys(obj).forEach(key => {
                if(key === '_id' && obj.id) {
                    graph[id]['id'] = obj.id
                    return
                }
                if(key === '_type') return
                graph[id][key] = obj[key]
            })
        })
        return graph
    }
}

class CommandGenerator {
    constructor(graph, settings) {
        this.graph = graph
    }
    createOp(type) {
        return {
            type: type,
            host: this.graph.getHostId(),
            timestamp: Date.now(),
            uuid: this.graph.makeGUID(),
        }
    }
    createObject() {
        const op = this.createOp(EVENT_TYPES.CREATE_OBJECT)
        op.id = this.graph.makeGUID()
        return op
    }
    createProperty(id,name,value){
        const op = this.createOp(EVENT_TYPES.CREATE_PROPERTY)
        op.object = id
        op.name = name
        op.value = value
        return op
    }
    setProperty(id, name, value) {
        const op = this.createOp(EVENT_TYPES.SET_PROPERTY)
        op.object = id
        op.name = name
        op.value = value
        return op
    }


    createArray() {
        const op = this.createOp(EVENT_TYPES.CREATE_ARRAY)
        op.id = this.graph.makeGUID()
        return op
    }

    insertElement(arrid, index, elementid) {
        const op = this.createOp(EVENT_TYPES.INSERT_ELEMENT)
        op.array = arrid
        op.value = elementid
        op.entryid = this.graph.makeGUID()
        op.prev = -1
        if(index > 0) {
            op.prev = this.graph.getObjectById(arrid)._elements[index - 1]._id
        }
        return op
    }
    removeElement(arrid, index) {
        const op = this.createOp(EVENT_TYPES.DELETE_ELEMENT)
        op.array = arrid
        op.entry = this.graph.getObjectById(arrid)._elements[index]._id
        return op
    }
}
class DocGraph {
    constructor(settings) {
        this.graph = new ObjectSyncProtocol(settings)
        this.commands = new CommandGenerator(this.graph,settings)
    }

    onChange(cb) {
        return this.graph.onChange(cb)
    }
    offChange(cb) {
        return this.graph.offChange(cb)
    }

    process(op) {
        return this.graph.process(op)
    }

    getObjectById(id) {
        return this.graph.getObjectById(id)
    }

    getObjectByProperty(key, value) {
        return this.graph.getObjectByProperty(key, value)
    }

    getPropertyValue(objid, key) {
        return this.graph.getPropertyValue(objid, key)
    }

    hasPropertyValue(objid, key) {
        return this.graph.hasPropertyValue(objid, key)
    }

    getPropertiesForObject(objid) {
        return this.graph.getPropertiesForObject(objid)
    }
    getArrayLength(id) {
        return this.graph.getArrayLength(id)
    }
    getElementAt(id,index) {
        return this.graph.getElementAt(id,index)
    }
    getHostId() {
        return this.graph.getHostId()
    }
    hasObject(objid) {
        return this.graph.hasObject(objid)
    }
    makeGUID() {
        return this.graph.makeGUID()
    }


    dumpGraph() {
        return this.graph.dumpGraph()
    }

    createObject() {
        const op = this.commands.createObject()
        return this.graph.process(op)
    }

    createProperty(id, name, value) {
        const op = this.commands.createProperty(id,name,value)
        return this.graph.process(op)
    }

    setProperty(id, name, value) {
        const op = this.commands.setProperty(id,name,value)
        return this.graph.process(op)
    }

    deleteProperty(id, name) {
        const op = {
            type: EVENT_TYPES.DELETE_PROPERTY,
            host: this.graph.getHostId(),
            object: id,
            name: name,
        }
        return this.graph.process(op)
    }

    deleteObject(id) {
        const op = {
            type: EVENT_TYPES.DELETE_OBJECT,
            host: this.graph.getHostId(),
            id: id,
        }
        return this.graph.process(op)
    }

    createArray() {
        const op = this.commands.createArray()
        return this.graph.process(op)
    }

    insertElement(arrid, index, elementid) {
        const op = this.commands.insertElement(arrid,index,elementid)
        return this.graph.process(op)
    }
    removeElement(arrid, index) {
        const op = this.commands.removeElement(arrid,index)
        return this.graph.process(op)
    }
    getHistory() {
        return this.graph.getHistory()
    }

}

class HistoryView {
    constructor(graph) {
        this.history = []
        this.listeners = []
        graph.onChange((e)=>{
            const obj = { type:e.type, host: e.host, timestamp: e.timestamp}
            if(e.type === EVENT_TYPES.CREATE_PROPERTY || e.type === EVENT_TYPES.SET_PROPERTY) {
                obj.name = e.name
                obj.value = e.value
            }
            this.history.push(obj)
            this.fire(obj)
        })
    }
    onChange(cb) {
        this.listeners.push(cb)
    }
    fire(obj) {
        this.listeners.forEach(cb => cb(obj))
    }
    dump() {
        return this.history
    }
}

module.exports.ObjectSyncProtocol = ObjectSyncProtocol
module.exports.DocGraph = DocGraph
module.exports.HistoryView = HistoryView
module.exports.CommandGenerator = CommandGenerator
Object.keys(EVENT_TYPES).forEach(key => {
    module.exports[key] = EVENT_TYPES[key]
})
